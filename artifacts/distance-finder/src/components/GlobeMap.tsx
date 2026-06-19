import React, { useRef, useEffect, useCallback, Component } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { haversineKm } from "@/lib/geo";

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
}

/**
 * Generates the raw ring boundary (unwrapped longitudes, no closing duplicate).
 * i < steps so the last point is NOT a repeat of the first.
 */
function geodesicRing(lat: number, lon: number, radiusKm: number, steps = 128): number[][] {
  const d = radiusKm / 6371.0088;
  if (d >= Math.PI) return [];
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const ring: number[][] = [];
  for (let i = 0; i < steps; i++) {
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
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  for (let i = 1; i < ring.length; i++) {
    while (ring[i][0] - ring[i - 1][0] > 180) ring[i][0] -= 360;
    while (ring[i][0] - ring[i - 1][0] < -180) ring[i][0] += 360;
  }
  return ring;
}

/**
 * Builds the fill geometry (Polygon or MultiPolygon) and outline LineString for a
 * geodesic circle.  For circles that cross a pole, a MultiPolygon is used so the
 * polar cap is a plain rectangle separate from the bowl — this avoids the 360°-span
 * artefact and prevents cap seam edges leaking into the outline.
 */
function buildCircleGeometry(lat: number, lon: number, radiusKm: number) {
  const d = radiusKm / 6371.0088;
  if (d >= Math.PI) return null;
  const latR = (lat * Math.PI) / 180;
  const containsNorthPole = latR + d > Math.PI / 2;
  const containsSouthPole = latR - d < -Math.PI / 2;

  const ring = geodesicRing(lat, lon, radiusKm);
  if (ring.length < 3) return null;

  const lonStart = ring[0][0];
  const lonEnd   = ring[ring.length - 1][0]; // ≈ lonStart − 360 for pole-crossing circles
  const latTop   = ring[0][1];               // reflected latitude at θ = 0

  if (!containsNorthPole && !containsSouthPole) {
    const closedRing = [...ring, ring[0]];
    return {
      fill: { type: "Polygon" as const, coordinates: [closedRing] },
      line: closedRing,
    };
  }

  // Pole-crossing — split into two non-overlapping polygons so there is no double shading
  // and no 360°-spanning single polygon that MapLibre fills incorrectly.
  const capLat = containsNorthPole ? 89.9 : -89.9;

  // Bowl: the curved ring closed with a 360° horizontal segment at latTop.
  const bowlRing = [...ring, ring[0]];

  // Cap rectangle: CCW winding (lower-left → lower-right → upper-right → upper-left → close).
  // lonEnd ≈ lonStart − 360 so the rectangle spans the full 360° of longitude.
  const capRing = [
    [lonEnd,   latTop],
    [lonStart, latTop],
    [lonStart, capLat],
    [lonEnd,   capLat],
    [lonEnd,   latTop],
  ];

  return {
    fill: {
      type: "MultiPolygon" as const,
      coordinates: [[bowlRing], [capRing]],
    },
    // Outline is only the ring boundary — no cap edges drawn as lines on the map.
    line: ring,
  };
}

function greatCirclePoints(
  lng1: number, lat1: number,
  lng2: number, lat2: number,
  steps = 120
): number[][] {
  const toR = (d: number) => (d * Math.PI) / 180;
  const la1 = toR(lat1), lo1 = toR(lng1);
  const la2 = toR(lat2), lo2 = toR(lng2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((la2 - la1) / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
  ));
  if (d === 0) return [[lng1, lat1]];
  const coords: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    coords.push([
      (Math.atan2(y, x) * 180) / Math.PI,
      (Math.atan2(z, Math.sqrt(x ** 2 + y ** 2)) * 180) / Math.PI,
    ]);
  }
  return coords;
}

function makeMarkerEl(color: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;align-items:center;gap:5px;pointer-events:none;";

  const dot = document.createElement("div");
  dot.style.cssText = [
    `background:${color}`,
    "width:10px",
    "height:10px",
    "border-radius:50%",
    "flex-shrink:0",
    `box-shadow:0 0 0 2px rgba(255,255,255,0.9),0 0 6px ${color}`,
  ].join(";");

  const pill = document.createElement("div");
  pill.style.cssText = [
    "background:rgba(255,255,255,0.92)",
    "backdrop-filter:blur(4px)",
    "-webkit-backdrop-filter:blur(4px)",
    "border-radius:20px",
    "padding:2px 8px",
    "box-shadow:0 1px 4px rgba(0,0,0,0.18)",
    "display:flex",
    "align-items:center",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = text;
  label.style.cssText = [
    `color:${color === "#93c5fd" ? "#1d4ed8" : "#92400e"}`,
    "font-size:11px",
    "font-weight:700",
    "font-family:system-ui,-apple-system,sans-serif",
    "white-space:nowrap",
    "letter-spacing:0.02em",
  ].join(";");

  pill.appendChild(label);
  el.appendChild(dot);
  el.appendChild(pill);
  return el;
}

function NoWebGLFallback() {
  return (
    <div
      data-testid="map-container"
      className="w-full rounded-3xl border border-border/30 bg-card/40 flex flex-col items-center justify-center gap-3 text-center px-8"
      style={{ height: 500 }}
    >
      <span className="text-4xl">🌍</span>
      <p className="text-muted-foreground font-medium">3D globe requires WebGL</p>
      <p className="text-sm text-muted-foreground/60">
        Available in Chrome, Firefox, Safari, and most mobile browsers.
      </p>
    </div>
  );
}

class GlobeErrorBoundary extends Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    if (this.state.crashed) return <NoWebGLFallback />;
    return this.props.children;
  }
}

function GlobeInner({
  userLat, userLon, destLat, destLon, radiusMiles, destName,
  userLabel = "You are here", pickMode, onPickLocation,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const readyRef = useRef(false);
  const [noWebGL, setNoWebGL] = React.useState(false);

  const hasUser = userLat !== undefined && userLon !== undefined;
  const hasDest = destLat !== undefined && destLon !== undefined;
  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

  const updateLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    // Arc
    const arcCoords =
      hasUser && hasDest
        ? greatCirclePoints(userLon!, userLat!, destLon!, destLat!)
        : [];
    (map.getSource("arc") as maplibregl.GeoJSONSource)?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: arcCoords },
    });

    // Radius circle
    const circleGeom = radiusKm && hasUser
      ? buildCircleGeometry(userLat!, userLon!, radiusKm)
      : null;
    (map.getSource("radius") as maplibregl.GeoJSONSource)?.setData({
      type: "Feature",
      properties: {},
      geometry: circleGeom
        ? circleGeom.fill
        : { type: "Polygon", coordinates: [[]] },
    });
    (map.getSource("radius-ring") as maplibregl.GeoJSONSource)?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: circleGeom ? circleGeom.line : [] },
    });

    // Markers — anchor:'left' so the dot sits exactly on the coordinate
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (hasUser) {
      markersRef.current.push(
        new maplibregl.Marker({ element: makeMarkerEl("#93c5fd", userLabel), anchor: "left" })
          .setLngLat([userLon!, userLat!])
          .addTo(map)
      );
    }
    if (hasDest) {
      markersRef.current.push(
        new maplibregl.Marker({ element: makeMarkerEl("#fbbf24", destName || "Destination"), anchor: "left" })
          .setLngLat([destLon!, destLat!])
          .addTo(map)
      );
    }

    // Camera — build bounds from all visible content then fitBounds
    const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
    const clampLng = (v: number) => Math.max(-180, Math.min(180, v));

    if (!hasUser) {
      map.flyTo({ center: [15, 30], zoom: 1.5, duration: 800 });
    } else {
      let minLng = userLon!, maxLng = userLon!;
      let minLat = userLat!, maxLat = userLat!;

      // Expand for radius circle — clamp so we never exceed valid map bounds
      if (radiusKm) {
        const latDeg = radiusKm / 111.32;
        const cosLat = Math.cos((userLat! * Math.PI) / 180);
        const lngDeg = cosLat > 0.001 ? radiusKm / (111.32 * cosLat) : 180;
        minLng = clampLng(userLon! - lngDeg);
        maxLng = clampLng(userLon! + lngDeg);
        minLat = clampLat(userLat! - latDeg);
        maxLat = clampLat(userLat! + latDeg);
      }

      // Expand for destination
      if (hasDest && destLat !== undefined && destLon !== undefined) {
        minLng = Math.min(minLng, destLon!);
        maxLng = Math.max(maxLng, destLon!);
        minLat = clampLat(Math.min(minLat, destLat!));
        maxLat = clampLat(Math.max(maxLat, destLat!));
      }

      // If radius covers most of the globe just zoom out to world view
      if (minLng <= -179 && maxLng >= 179 && minLat <= -84 && maxLat >= 84) {
        map.flyTo({ center: [userLon!, userLat!], zoom: 0.5, duration: 800 });
      } else {
        map.fitBounds(
          [[minLng, minLat], [maxLng, maxLat]],
          { padding: 80, maxZoom: 12, duration: 800 }
        );
      }
    }
  }, [hasUser, hasDest, userLat, userLon, destLat, destLon, radiusKm, destName, userLabel]);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [15, 30],
        zoom: 1.5,
        minZoom: 0.5,
        maxZoom: 18,
        attributionControl: false,
      });
    } catch {
      setNoWebGL(true);
      return;
    }

    mapRef.current = map;

    map.on("load", () => {
      try {
        (map as any).setProjection({ type: "globe" });
      } catch {}

      map.addSource("arc", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
      });
      map.addLayer({
        id: "arc-layer",
        type: "line",
        source: "arc",
        paint: {
          "line-color": "rgba(147,197,253,0.75)",
          "line-width": 1.5,
        },
      });

      map.addSource("radius", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[]] } },
      });
      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius",
        paint: {
          "fill-color": "rgba(251,191,36,0.15)",
        },
      });

      // Outline is a separate LineString source so cap seam edges are never drawn as lines.
      map.addSource("radius-ring", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
      });
      map.addLayer({
        id: "radius-ring-layer",
        type: "line",
        source: "radius-ring",
        paint: {
          "line-color": "rgba(251,191,36,0.9)",
          "line-width": 1.5,
        },
      });

      readyRef.current = true;
      updateLayers();
    });

    map.on("error", (e: any) => {
      const isWebGLInit =
        e?.error?.type === "webglcontextcreationerror" ||
        String(e?.error?.message ?? "").includes("Failed to initialize WebGL");
      if (isWebGLInit) setNoWebGL(true);
    });

    return () => {
      readyRef.current = false;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
    };
  }, []);

  useEffect(() => {
    updateLayers();
  }, [updateLayers]);

  // Pick mode: crosshair cursor + click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const canvas = map.getCanvas();
    if (pickMode) {
      canvas.style.cursor = "crosshair";
      const handler = (e: maplibregl.MapMouseEvent) => {
        onPickLocation?.(e.lngLat.lat, e.lngLat.lng);
      };
      map.on("click", handler);
      return () => { map.off("click", handler); canvas.style.cursor = ""; };
    } else {
      canvas.style.cursor = "";
      return;
    }
  }, [pickMode, onPickLocation]);

  if (noWebGL) return <NoWebGLFallback />;

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/30 shadow-2xl"
      style={{ height: 500 }}
    />
  );
}

export default function GlobeMap(props: GlobeMapProps) {
  return (
    <GlobeErrorBoundary>
      <GlobeInner {...props} />
    </GlobeErrorBoundary>
  );
}
