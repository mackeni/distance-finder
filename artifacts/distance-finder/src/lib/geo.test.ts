import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  haversineKm,
  getBearing,
  getCompassDirection,
  northSouthKm,
  northSouthDir,
  eastWestKm,
  eastWestDir,
} from "./geo.ts";

const R = 6371;
const KM_PER_DEG = (Math.PI * R) / 180; // ≈ 111.19 km

function near(actual: number, expected: number, tol: number, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? "value"}: expected ${expected} ± ${tol}, got ${actual}`,
  );
}

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    assert.equal(haversineKm(51.5, -0.12, 51.5, -0.12), 0);
  });

  it("matches a known city pair (London → Paris ≈ 344 km)", () => {
    near(haversineKm(51.5074, -0.1278, 48.8566, 2.3522), 343.5, 1.5);
  });

  it("gives half the circumference for antipodal points", () => {
    near(haversineKm(10, 20, -10, -160), Math.PI * R, 0.01); // atan2 loses a little precision right at the antipode
  });

  it("is symmetric", () => {
    near(haversineKm(35.68, 139.69, 37.77, -122.42), haversineKm(37.77, -122.42, 35.68, 139.69), 1e-9);
  });
});

describe("getBearing", () => {
  it("returns the four cardinal bearings", () => {
    near(getBearing(0, 0, 10, 0), 0, 1e-9, "north");
    near(getBearing(0, 0, 0, 10), 90, 1e-9, "east");
    near(getBearing(10, 0, 0, 0), 180, 1e-9, "south");
    near(getBearing(0, 10, 0, 0), 270, 1e-9, "west");
  });

  it("stays in [0, 360)", () => {
    const b = getBearing(0, 0, 1, -1);
    assert.ok(b >= 0 && b < 360);
    near(b, 315, 0.1);
  });

  it("takes the short way across the antimeridian", () => {
    near(getBearing(0, 179, 0, -179), 90, 1e-9);
  });
});

describe("getCompassDirection", () => {
  it("rounds to the nearest of eight points", () => {
    assert.equal(getCompassDirection(0), "North");
    assert.equal(getCompassDirection(22), "North");
    assert.equal(getCompassDirection(23), "Northeast");
    assert.equal(getCompassDirection(180), "South");
    assert.equal(getCompassDirection(359), "North");
  });
});

describe("north/south component", () => {
  it("measures along the meridian", () => {
    near(northSouthKm(0, 50, 1), KM_PER_DEG, 1e-6);
    near(northSouthKm(10, 50, -10), 20 * KM_PER_DEG, 1e-6);
  });

  it("labels direction", () => {
    assert.equal(northSouthDir(0, 1), "N");
    assert.equal(northSouthDir(1, 0), "S");
  });
});

describe("east/west component", () => {
  it("measures along the parallel, shrinking with cos(lat)", () => {
    near(eastWestKm(0, 0, 1), KM_PER_DEG, 1e-6, "equator");
    near(eastWestKm(0, 60, 1), KM_PER_DEG / 2, 1e-6, "60°");
    near(eastWestKm(0, 90, 50), 0, 1e-6, "pole");
  });

  it("is longer than the great circle between the same points at high latitude", () => {
    // Regression: it used to return the great-circle distance (6,644 km here).
    near(eastWestKm(0, 60, 170), 9452, 1);
    assert.ok(eastWestKm(0, 60, 170) > haversineKm(60, 0, 60, 170));
  });

  it("takes the short way around", () => {
    near(eastWestKm(179, 0, -179), 2 * KM_PER_DEG, 1e-6);
    near(eastWestKm(-170, 0, 170), 20 * KM_PER_DEG, 1e-6);
  });

  it("labels direction by the short way around", () => {
    assert.equal(eastWestDir(0, 10), "E");
    assert.equal(eastWestDir(10, 0), "W");
    assert.equal(eastWestDir(179, -179), "E");
    assert.equal(eastWestDir(-179, 179), "W");
  });
});
