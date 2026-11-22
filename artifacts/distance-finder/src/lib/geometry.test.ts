import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { haversineKm } from "./geo.ts";
import {
  geodesicCircle,
  unwrapAntimeridian,
  lonNear,
  greatCirclePoints,
  geodesicCircleForMapLibre,
  geodesicCircleOutline,
  circleLonHalfWidthDeg,
  worldMinusIsland,
  WORLD_RING,
} from "./geometry.ts";

const R = 6371.0088;
const HALF_CIRCUMFERENCE = Math.PI * R;

type Pt = [number, number];

function near(actual: number, expected: number, tol: number, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? "value"}: expected ${expected} ± ${tol}, got ${actual}`,
  );
}

function maxLonStep(pts: Pt[]): number {
  let max = 0;
  for (let i = 1; i < pts.length; i++) max = Math.max(max, Math.abs(pts[i][0] - pts[i - 1][0]));
  return max;
}

/** Longitudes equal modulo 360. */
function sameLon(a: number, b: number, tol = 1e-6): boolean {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d) <= tol;
}

describe("unwrapAntimeridian / lonNear", () => {
  it("removes ±360 jumps", () => {
    assert.deepEqual(unwrapAntimeridian([[179, 0], [-179, 1], [-178, 2]]), [[179, 0], [181, 1], [182, 2]]);
    assert.deepEqual(unwrapAntimeridian([[-179, 0], [179, 0]]), [[-179, 0], [-181, 0]]);
  });

  it("leaves a continuous ring untouched", () => {
    const ring: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 0]];
    assert.deepEqual(unwrapAntimeridian(ring), ring);
  });

  it("lonNear shifts by whole turns to within 180° of the reference", () => {
    assert.equal(lonNear(-179, 179), 181);
    assert.equal(lonNear(179, -179), -181);
    assert.equal(lonNear(10, -5), 10);
    assert.equal(lonNear(370, 0), 10);
  });
});

describe("greatCirclePoints", () => {
  it("starts and ends at the two points", () => {
    const pts = greatCirclePoints(51.5, -0.12, 40.7, -74);
    near(pts[0][1], 51.5, 1e-9);
    assert.ok(sameLon(pts[0][0], -0.12));
    near(pts.at(-1)![1], 40.7, 1e-9);
    assert.ok(sameLon(pts.at(-1)![0], -74));
  });

  it("stays continuous across the antimeridian (Tokyo → San Francisco)", () => {
    // Regression: longitudes used to wrap to ±180, jumping ~360° mid-line.
    const pts = greatCirclePoints(35.68, 139.69, 37.77, -122.42);
    assert.ok(maxLonStep(pts) < 5, `max step ${maxLonStep(pts)}`);
    assert.ok(sameLon(pts.at(-1)![0], -122.42));
  });

  it("handles identical points", () => {
    assert.equal(greatCirclePoints(10, 20, 10, 20).length, 2);
  });
});

describe("geodesicCircle", () => {
  it("puts every point at the requested distance and closes the ring", () => {
    const pts = geodesicCircle(48.85, 2.35, 500);
    for (const [lon, lat] of pts) near(haversineKm(48.85, 2.35, lat, lon), 500, 1.5);
    near(pts[0][0], pts.at(-1)![0], 1e-9);
    near(pts[0][1], pts.at(-1)![1], 1e-9);
  });

  it("refines near a pole so no step jumps more than a few degrees", () => {
    // Centre at 80°N with a radius that skims ~0.1° past the North Pole.
    const pts = unwrapAntimeridian(geodesicCircle(80, 0, 9.9 * (Math.PI / 180) * R));
    assert.ok(maxLonStep(pts) <= 3 + 1e-9, `max step ${maxLonStep(pts)}`);
  });
});

describe("geodesicCircleForMapLibre", () => {
  it("uses a single plain ring for a small circle", () => {
    const g = geodesicCircleForMapLibre(51.5, -0.12, 200) as GeoJSON.Polygon;
    assert.equal(g.type, "Polygon");
    assert.equal(g.coordinates.length, 1);
    assert.ok(g.coordinates[0].every(([, lat]) => Math.abs(lat) < 90));
  });

  it("caps the pole for a circle that encloses it", () => {
    const g = geodesicCircleForMapLibre(80, 0, 2000) as GeoJSON.Polygon;
    assert.equal(g.type, "Polygon");
    assert.ok(g.coordinates[0].some(([, lat]) => lat === 90));
    assert.ok(!g.coordinates[0].some(([, lat]) => lat === -90));
  });

  it("caps the South Pole for a southern circle", () => {
    const g = geodesicCircleForMapLibre(-75, 100, 2500) as GeoJSON.Polygon;
    assert.ok(g.coordinates[0].some(([, lat]) => lat === -90));
  });

  it("switches to world-minus-island once the radius passes 90° + |lat|", () => {
    const g = geodesicCircleForMapLibre(0, 0, 0.6 * HALF_CIRCUMFERENCE);
    assert.equal(g.type, "MultiPolygon");
    assert.equal((g as GeoJSON.MultiPolygon).coordinates.length, 4);
  });

  it("covers the whole world at half the circumference or more", () => {
    const g = geodesicCircleForMapLibre(30, 30, HALF_CIRCUMFERENCE + 1) as GeoJSON.Polygon;
    assert.deepEqual(g.coordinates, [WORLD_RING]);
  });
});

describe("worldMinusIsland", () => {
  it("puts the island as a hole in a tight box and covers 360° around it", () => {
    const island: Pt[] = [[10, 10], [10, 20], [20, 20], [20, 10], [10, 10]];
    const [[north], [south], [middle], [box, hole]] = worldMinusIsland(island);
    assert.deepEqual(hole, island);
    const span = (r: Pt[]) => Math.max(...r.map(p => p[0])) - Math.min(...r.map(p => p[0]));
    near(span(north), 360, 1e-9);
    near(span(south), 360, 1e-9);
    near(span(box) + span(middle), 360, 1e-9);
  });
});

describe("geodesicCircleOutline", () => {
  it("is empty when the whole world is in range", () => {
    assert.deepEqual(geodesicCircleOutline(0, 0, HALF_CIRCUMFERENCE), { type: "LineString", coordinates: [] });
  });

  it("is the circle edge otherwise", () => {
    const g = geodesicCircleOutline(0, 0, 1000) as GeoJSON.LineString;
    assert.equal(g.type, "LineString");
    assert.ok(g.coordinates.length > 100);
  });
});

describe("circleLonHalfWidthDeg", () => {
  const degKm = (deg: number) => deg * (Math.PI / 180) * R;

  it("equals the angular radius at the equator", () => {
    near(circleLonHalfWidthDeg(0, degKm(5)), 5, 1e-9);
  });

  it("grows with latitude (≈ double at 60° for a small circle)", () => {
    near(circleLonHalfWidthDeg(60, degKm(1)), 2, 0.01);
    near(circleLonHalfWidthDeg(-60, degKm(1)), 2, 0.01);
  });

  it("spans every longitude once the circle reaches a pole", () => {
    assert.equal(circleLonHalfWidthDeg(80, degKm(10.5)), 180); // pole is 10° away
    assert.equal(circleLonHalfWidthDeg(90, 1), 180);
  });
});
