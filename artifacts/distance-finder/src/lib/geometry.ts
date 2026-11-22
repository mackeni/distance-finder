/**
 * Raw geodesic circle — clockwise [lon, lat] points, adaptively refined.
 *
 * Equal steps in bearing don't mean equal steps in longitude: when the
 * boundary passes close to a pole (without necessarily enclosing it — this
 * happens for any circle whose radius puts it within a few degrees of one),
 * longitude sweeps extremely fast for a tiny bearing change near that closest
 * approach. At the base 256-step resolution that can leave two consecutive
 * points 80+ degrees apart in longitude, so the polygon draws a straight
 * chord across a huge swath of the map instead of hugging the pole — a stray
 * triangular fill artifact. Wherever a step's jump is too large, bisect the
 * bearing and recurse until it isn't.
 */
export function geodesicCircle(lat: number, lon: number, radiusKm: number, steps = 256): [number, number][] {
  const d = radiusKm / 6371.0088;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;

  const pointAt = (θ: number): [number, number] => {
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(θ)
    );
    const lon2 =
      lonR +
      Math.atan2(
        Math.sin(θ) * Math.sin(d) * Math.cos(latR),
        Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
      );
    return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
  };

  const MAX_JUMP_DEG = 3;
  const MAX_DEPTH = 12;
  const refine = (
    θA: number, θB: number, a: [number, number], b: [number, number], depth: number
  ): [number, number][] => {
    let dLon = Math.abs(a[0] - b[0]);
    if (dLon > 180) dLon = 360 - dLon;
    const dLat = Math.abs(a[1] - b[1]);
    if (depth >= MAX_DEPTH || Math.max(dLon, dLat) <= MAX_JUMP_DEG) return [a];
    const θMid = (θA + θB) / 2;
    const mid = pointAt(θMid);
    return [...refine(θA, θMid, a, mid, depth + 1), ...refine(θMid, θB, mid, b, depth + 1)];
  };

  const thetas: number[] = [];
  for (let i = 0; i <= steps; i++) thetas.push((i / steps) * 2 * Math.PI);
  const base = thetas.map(pointAt);

  const coords: [number, number][] = [];
  for (let i = 0; i < base.length - 1; i++) {
    coords.push(...refine(thetas[i], thetas[i + 1], base[i], base[i + 1], 0));
  }
  coords.push(base[base.length - 1]);
  return coords;
}

/** Rewalk a ring's longitudes as a continuous unwrapped path (no ±180° jumps). */
export function unwrapAntimeridian(raw: [number, number][]): [number, number][] {
  const out: [number, number][] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    let dLon = raw[i][0] - out[i - 1][0];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    out.push([out[i - 1][0] + dLon, raw[i][1]]);
  }
  return out;
}

/** CCW + antimeridian-unwrapped ring for MapLibre GL (use as outer/fill ring). */
export function geodesicCircleMapLibre(lat: number, lon: number, radiusKm: number): [number, number][] {
  const raw = geodesicCircle(lat, lon, radiusKm);
  raw.reverse(); // CW → CCW
  return unwrapAntimeridian(raw);
}

/** CW + antimeridian-unwrapped ring — use as a hole ring inside a polygon. */
export function geodesicCircleMapLibreCW(lat: number, lon: number, radiusKm: number): [number, number][] {
  const raw = geodesicCircle(lat, lon, radiusKm); // already CW
  return unwrapAntimeridian(raw);
}

/** World-spanning outer ring (CCW) — used as the fill base for large circles. */
export const WORLD_RING: [number, number][] = [
  [-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90],
];

/**
 * Integrate a polar cap into a ring by adding two pole-crossing segments.
 * Works for both CCW outer rings and CW hole rings.
 *
 * The input ring is already a full 2π sweep of the circle boundary. When that
 * circle encloses a pole, its first and last points are the same geographic
 * location but land ~360° apart in unwrapped longitude (the sweep winds all
 * the way around the pole) — unlike a non-polar ring, where first === last
 * exactly. Dropping the last point as a "duplicate" here throws away the real
 * far-side meridian and caps the polygon a step short, leaving a sliver seam
 * near the antimeridian. Keep both endpoints so the cap closes at the true
 * unwrapped longitudes.
 */
export function withPolarCap(ring: [number, number][], poleLat: number): [number, number][] {
  const firstLon = ring[0][0];
  const lastLon = ring[ring.length - 1][0];
  return [...ring, [lastLon, poleLat], [firstLon, poleLat], ring[0]];
}

/**
 * Express "world minus a small, pole-free island" as four simple polygons —
 * three plain hole-free rectangles plus one small rectangle that uses the
 * island as an ordinary GeoJSON hole.
 *
 * MapLibre GL's polygon tessellation (earcut, fed via geojson-vt) turns out
 * to unpredictably mis-triangulate a hole cut into a *world-spanning*
 * rectangle. It first showed up as a hole sitting close to a pole, but
 * further testing found it isn't really about poles: two hand-rolled
 * "single ring with a slit" encodings that stood in for the hole each
 * rendered correctly for one test case and produced a stray filled
 * triangle, or filled almost nothing at all, for another — both simple,
 * non-self-crossing rings by every check applied to them, so the fault was
 * in earcut's handling of a ring that touches itself at a single vertex to
 * fake a hole, not in the geometry. Since the failures didn't correlate
 * with proximity to a pole once tested more broadly, the safe conclusion is
 * that a hole's *scale relative to its containing ring* is what matters:
 * cutting a small hole into a small, tightly-fitted rectangle around it
 * only (rather than the whole WORLD_RING) reproduced correctly in every
 * case tried, including ones that failed both earlier approaches.
 *
 * So: fit a rectangle snugly around the island (plus a margin) and give it
 * the island as a genuine hole — small and unremarkable enough for earcut
 * to triangulate normally — then cover the rest of the globe with three
 * plain rectangles that need no holes at all: north of the box, south of
 * it, and a middle strip at the box's own latitude band running the long
 * way around from the box's right edge back to its left edge. Everything is
 * expressed relative to the box's own (possibly antimeridian-crossing,
 * possibly far outside +-180) longitude bounds rather than assuming a
 * +-180 world, so it stays correct regardless of where the island sits.
 */
export function worldMinusIsland(island: [number, number][]): [number, number][][][] {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of island) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const MARGIN = 2; // degrees of clearance around the island — imperceptible at map scale
  const L = minLon - MARGIN;
  const R = maxLon + MARGIN;
  const bottom = Math.max(-90, minLat - MARGIN);
  const top = Math.min(90, maxLat + MARGIN);

  const box: [number, number][] = [[L, bottom], [L, top], [R, top], [R, bottom], [L, bottom]];
  const north: [number, number][] = [[L, top], [L, 90], [L + 360, 90], [L + 360, top], [L, top]];
  const south: [number, number][] = [[L, -90], [L, bottom], [L + 360, bottom], [L + 360, -90], [L, -90]];
  const middle: [number, number][] = [[R, bottom], [R, top], [L + 360, top], [L + 360, bottom], [R, bottom]];

  return [[north], [south], [middle], [box, island]];
}

/**
 * GeoJSON geometry for MapLibre GL that handles all radius sizes correctly.
 *
 * • radius < 90°+|lat| arc → direct polygon: the circle's own boundary ring,
 *   pole-capped if it encloses the one pole it can reach at this size.
 * • radius ≥ 90°+|lat| arc → world minus the antipodal complement cap,
 *   expressed as four simple polygons (see worldMinusIsland).
 * • radius ≥ 180° arc → full world rectangle
 *
 * The threshold is *not* simply 90° (a hemisphere). A circle's boundary ring
 * can only ever wrap one pole by itself — wrapping both at once isn't a
 * single simple loop, since the "inside" would be everywhere except a
 * plain island nowhere near either pole. So the direct-ring strategy stays
 * valid past the hemisphere mark, right up until the *complement* cap would
 * itself have to wrap the far pole (which happens once the radius reaches
 * 90°+|lat| — the complement's distance from that pole) — so hand off to
 * the world-minus-island strategy only once that can no longer happen.
 */
export function geodesicCircleForMapLibre(
  lat: number, lon: number, radiusKm: number
): GeoJSON.Geometry {
  const d = radiusKm / 6371.0088; // angular radius in radians

  // Entire globe
  if (d >= Math.PI) {
    return { type: "Polygon", coordinates: [WORLD_RING] };
  }

  const degRadius = (d * 180) / Math.PI;
  const safeHoleThreshold = 90 + Math.abs(lat);

  // Large circle: shade = world minus antipodal complement cap.
  // Safe once the complement can't reach the far pole (see comment above).
  if (degRadius >= safeHoleThreshold) {
    const antipodeLat = -lat;
    const antipodeLon = lon >= 0 ? lon - 180 : lon + 180;
    const complementKm = (Math.PI - d) * 6371.0088;
    const hole = geodesicCircleMapLibreCW(antipodeLat, antipodeLon, complementKm);
    return { type: "MultiPolygon", coordinates: worldMinusIsland(hole) };
  }

  // Direct circle — covers both the plain case and the "large but still
  // single-pole" case up to safeHoleThreshold.
  const ring = geodesicCircleMapLibre(lat, lon, radiusKm);
  const includesNP = lat + degRadius > 90;
  const includesSP = lat - degRadius < -90;

  if (!includesNP && !includesSP) {
    return { type: "Polygon", coordinates: [ring] };
  }

  // Pole-capped single ring
  return {
    type: "Polygon",
    coordinates: [withPolarCap(ring, includesNP ? 90 : -90)],
  };
}

/**
 * The circle's true edge, for the outline layer — deliberately separate from
 * geodesicCircleForMapLibre's fill polygon. That polygon adds pole-crossing
 * cap segments and, for large radii, the WORLD_RING rectangle — neither is
 * part of the actual boundary (the pole sits deep inside the shaded area,
 * not on its edge), and drawing them as a line traces the antimeridian and
 * the poles as bold, meaningless strokes across the map. The raw circle ring
 * is already the correct edge in every case: a point at distance d from
 * (lat, lon) is always at distance (180°−d) from its antipode, so this same
 * curve is exactly the complement-cap boundary the fill's hole strategy cuts
 * out for large radii too — no antipode math needed here.
 */
export function geodesicCircleOutline(lat: number, lon: number, radiusKm: number): GeoJSON.Geometry {
  const d = radiusKm / 6371.0088;
  if (d >= Math.PI) {
    return { type: "LineString", coordinates: [] }; // whole world in range — no edge to draw
  }
  return { type: "LineString", coordinates: geodesicCircleMapLibre(lat, lon, radiusKm) };
}

/** Great-circle interpolated points — [lon, lat] for GeoJSON LineString. */
export function greatCirclePoints(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  steps = 100
): [number, number][] {
  const toR = (d: number) => (d * Math.PI) / 180;
  const [la1, lo1, la2, lo2] = [toR(lat1), toR(lon1), toR(lat2), toR(lon2)];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin((la2 - la1) / 2), 2) +
          Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)
      )
    );
  if (d === 0) return [[lon1, lat1], [lon2, lat2]];
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    const lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
    const lng = (Math.atan2(y, x) * 180) / Math.PI;
    pts.push([lng, lat]);
  }
  // atan2 wraps longitude to ±180, so a route crossing the antimeridian would
  // jump ~360° mid-line and streak across the whole map. Keep it continuous.
  return unwrapAntimeridian(pts);
}

/** Shift lon by a multiple of 360 so it lies within ±180° of ref. */
export function lonNear(lon: number, ref: number): number {
  return ref + (((lon - ref + 540) % 360) - 180);
}

/**
 * Longitude half-width, in degrees, of a geodesic circle — how far east/west
 * of its centre it reaches. Grows as 1/cos(lat) away from the equator (exactly
 * asin(sin d / cos lat)); once the circle reaches a pole it spans every
 * longitude, so this returns 180.
 */
export function circleLonHalfWidthDeg(lat: number, radiusKm: number): number {
  const d = radiusKm / 6371.0088;
  const latR = (lat * Math.PI) / 180;
  if (d >= Math.PI / 2 - Math.abs(latR)) return 180;
  return (Math.asin(Math.sin(d) / Math.cos(latR)) * 180) / Math.PI;
}
