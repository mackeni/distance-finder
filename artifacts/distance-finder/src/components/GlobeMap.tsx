import React, { useRef, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface GlobeMapProps {
  userLat?: number;
  userLon?: number;
  destLat?: number;
  destLon?: number;
  radiusMiles?: number;
  destName?: string;
  userLabel?: string;
  pickMode?: "from" | "to" | null;
  onPickLocation?: (lat: number, lng: number) => void;
  radiusPlaces?: { lat: number; lon: number; name: string }[];
}

/** Raw geodesic circle — clockwise [lon, lat] points, 256 steps. */
function geodesicCircle(lat: number, lon: number, radiusKm: number, steps = 256): [number, number][] {
  const d = radiusKm / 6371.0088;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(θ)
    );
    const lon2 =
      lonR +
      Math.atan2(
        Math.sin(θ) * Math.sin(d) * Math.cos(latR),
        Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
      );
    coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
}

/** CCW + antimeridian-unwrapped ring for MapLibre GL. */
function geodesicCircleMapLibre(lat: number, lon: number, radiusKm: number): [number, number][] {
  const raw = geodesicCircle(lat, lon, radiusKm);
  raw.reverse();
  const out: [number, number][] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    let dLon = raw[i][0] - out[i - 1][0];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    out.push([out[i - 1][0] + dLon, raw[i][1]]);
  }
  return out;
}

/**
 * GeoJSON geometry for MapLibre GL.
 * Returns Polygon for normal circles, MultiPolygon when the circle encloses
 * a pole — adding a rectangular cap from the boundary's extremal latitude to ±90°.
 */
function geodesicCircleForMapLibre(
  lat: number, lon: number, radiusKm: number
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const d = radiusKm / 6371.0088;
  const degRadius = (d * 180) / Math.PI;
  const includesNP = lat + degRadius > 90;
  const includesSP = lat - degRadius < -90;

  const ring = geodesicCircleMapLibre(lat, lon, radiusKm);

  if (!includesNP && !includesSP) {
    return { type: "Polygon", coordinates: [ring] };
  }

  const latR = (lat * Math.PI) / 180;
  const sinExt = includesNP
    ? Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d)
    : Math.sin(latR) * Math.cos(d) - Math.cos(latR) * Math.sin(d);
  const extremeLat = (Math.asin(Math.min(1, Math.max(-1, sinExt))) * 180) / Math.PI;
  const minRingLon = Math.min(...ring.map(p => p[0]));

  const capRing: [number, number][] = includesNP
    ? [
        [minRingLon,       extremeLat],
        [minRingLon + 360, extremeLat],
        [minRingLon + 360, 90],
        [minRingLon,       90],
        [minRingLon,       extremeLat],
      ]
    : [
        [minRingLon + 360, extremeLat],
        [minRingLon,       extremeLat],
        [minRingLon,       -90],
        [minRingLon + 360, -90],
        [minRingLon + 360, extremeLat],
      ];

  return { type: "MultiPolygon", coordinates: [[ring], [capRing]] };
}

/** Great-circle interpolated points — [lon, lat] for GeoJSON LineString. */
function greatCirclePoints(
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
  return pts;
}

// ─── 2D MapLibre view ─────────────────────────────────────────────────────────

function MapView({
  userLat, userLon, destLat, destLon, radiusMiles,
  destName, userLabel,
  pickMode, onPickLocation,
  radiusPlaces,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const placeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  const hasUser = userLat !== undefined && userLon !== undefined;
  const hasDest = destLat !== undefined && destLon !== undefined;
  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

  const emptyPoly: GeoJSON.Feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[]] }, properties: {} };
  const emptyLine: GeoJSON.Feature = { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} };

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [15, 30],
      zoom: 2,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => {
      map.addSource("radius", { type: "geojson", data: emptyPoly });
      map.addSource("arc", { type: "geojson", data: emptyLine });
      map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#fbbf24", "fill-opacity": 0.18 } });
      map.addLayer({ id: "arc-line", type: "line", source: "arc", paint: { "line-color": "#93c5fd", "line-width": 2.5, "line-opacity": 0.9 } });
      setMapLoaded(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // Fly to fit user + dest
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    if (!hasUser) return;
    if (hasDest && destLat !== undefined && destLon !== undefined) {
      map.fitBounds(
        [[Math.min(userLon!, destLon), Math.min(userLat!, destLat)],
         [Math.max(userLon!, destLon), Math.max(userLat!, destLat)]],
        { padding: 80, maxZoom: 10, duration: 800 }
      );
    } else if (radiusKm) {
      const degRadius = (radiusKm / 6371.0088) * (180 / Math.PI);
      map.fitBounds(
        [[userLon! - degRadius, userLat! - degRadius],
         [userLon! + degRadius, userLat! + degRadius]],
        { padding: 60, maxZoom: 10, duration: 800 }
      );
    } else {
      map.flyTo({ center: [userLon!, userLat!], zoom: 8, duration: 800 });
    }
  }, [mapLoaded, hasUser, hasDest, userLat, userLon, destLat, destLon]);

  // Arc layer
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    const coords = hasUser && hasDest
      ? greatCirclePoints(userLat!, userLon!, destLat!, destLon!)
      : [];
    (map.getSource("arc") as maplibregl.GeoJSONSource).setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {},
    });
  }, [mapLoaded, hasUser, hasDest, userLat, userLon, destLat, destLon]);

  // Radius layer
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    const geometry: GeoJSON.Geometry = hasUser && radiusKm
      ? geodesicCircleForMapLibre(userLat!, userLon!, radiusKm)
      : { type: "Polygon", coordinates: [[]] };
    (map.getSource("radius") as maplibregl.GeoJSONSource).setData({
      type: "Feature",
      geometry,
      properties: {},
    });
  }, [mapLoaded, hasUser, userLat, userLon, radiusKm]);

  // User marker
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    if (userMarkerRef.current) { userMarkerRef.current.remove(); userMarkerRef.current = null; }
    if (!hasUser) return;
    const el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;background:#93c5fd;border:2px solid white;border-radius:50%;box-shadow:0 0 6px rgba(147,197,253,0.8)";
    userMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([userLon!, userLat!])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(userLabel ?? "You are here"))
      .addTo(map);
  }, [mapLoaded, hasUser, userLat, userLon, userLabel]);

  // Dest marker
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null; }
    if (!hasDest) return;
    const el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;background:#fbbf24;border:2px solid white;border-radius:50%;box-shadow:0 0 6px rgba(251,191,36,0.8)";
    destMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([destLon!, destLat!])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(destName ?? "Destination"))
      .addTo(map);
  }, [mapLoaded, hasDest, destLat, destLon, destName]);

  // Airport markers
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    placeMarkersRef.current.forEach(m => m.remove());
    placeMarkersRef.current = [];
    if (!radiusPlaces) return;
    for (const place of radiusPlaces) {
      const el = document.createElement("div");
      el.style.cssText = "width:8px;height:8px;background:#86efac;border:1px solid white;border-radius:50%;opacity:0.85";
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([place.lon, place.lat])
        .setPopup(new maplibregl.Popup({ offset: 8 }).setText(place.name))
        .addTo(map);
      placeMarkersRef.current.push(marker);
    }
  }, [mapLoaded, radiusPlaces]);

  // Pick mode cursor + click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    map.getCanvas().style.cursor = pickMode ? "crosshair" : "";
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (pickMode && onPickLocation) onPickLocation(e.lngLat.lat, e.lngLat.lng);
    };
    map.on("click", onClick);
    return () => { map.off("click", onClick); };
  }, [mapLoaded, pickMode, onPickLocation]);

  return (
    <div
      data-testid="map-container"
      className="relative w-full rounded-3xl overflow-hidden border border-border/30 shadow-2xl"
      style={{ height: 500 }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {pickMode && (
        <div className="absolute inset-0 pointer-events-none flex items-start justify-center pt-4">
          <div className="bg-black/70 text-white text-sm font-semibold px-4 py-2 rounded-full backdrop-blur-sm">
            Click anywhere on the map to set {pickMode === "from" ? "start" : "destination"}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GlobeMap(props: GlobeMapProps) {
  return <MapView {...props} />;
}
