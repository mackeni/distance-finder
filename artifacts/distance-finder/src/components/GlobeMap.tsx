import React, { useRef, useEffect, useState, useMemo, useCallback, Component } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
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
  radiusPlaces?: { lat: number; lon: number; name: string }[];
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/** Closed geodesic circle ring — coordinates in [lon, lat] order for GeoJSON.
 *  Wound counter-clockwise (GeoJSON exterior ring convention).
 *  Longitudes are unwrapped around the antimeridian so MapLibre renders correctly. */
function geodesicCircle(lat: number, lon: number, radiusKm: number, steps = 256): [number, number][] {
  const d = radiusKm / 6371.0088;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const raw: [number, number][] = [];

  // Trace clockwise (θ increasing = N→E→S→W), then reverse to counter-clockwise for GeoJSON
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
    raw.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }

  // Reverse so the ring is counter-clockwise (GeoJSON fills the inside, not outside)
  raw.reverse();

  // Unwrap antimeridian jumps: keep each longitude within 180° of its predecessor
  const coords: [number, number][] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    let dLon = raw[i][0] - coords[i - 1][0];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    coords.push([coords[i - 1][0] + dLon, raw[i][1]]);
  }
  return coords;
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

// altitude below this triggers auto-switch to 2D map
const MAP_THRESHOLD = 0.08;

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

// ─── 2D MapLibre view ────────────────────────────────────────────────────────

interface MapViewProps extends GlobeMapProps {
  centerLat: number;
  centerLng: number;
  initialZoom: number;
  onBackToGlobe: () => void;
}

function MapView({
  centerLat, centerLng, initialZoom,
  userLat, userLon, destLat, destLon, radiusMiles,
  destName, userLabel,
  pickMode, onPickLocation,
  onBackToGlobe,
  radiusPlaces,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const placeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  const hasUser = userLat !== undefined && userLon !== undefined;
  const hasDest = destLat !== undefined && destLon !== undefined;
  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
            maxzoom: 19,
          },
        },
        layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
      } as maplibregl.StyleSpecification,
      center: [centerLng, centerLat],
      zoom: initialZoom,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      const emptyLine: GeoJSON.Feature = { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} };
      const emptyPoly: GeoJSON.Feature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[]] }, properties: {} };
      // Add sources
      map.addSource("radius", { type: "geojson", data: emptyPoly });
      map.addSource("arc", { type: "geojson", data: emptyLine });
      // Layer order: radius fill → radius outline → arc (arc drawn last = on top)
      map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#fbbf24", "fill-opacity": 0.18 } });
      map.addLayer({ id: "radius-outline", type: "line", source: "radius", paint: { "line-color": "#fbbf24", "line-width": 2, "line-opacity": 0.9 } });
      map.addLayer({ id: "arc-line", type: "line", source: "arc", paint: { "line-color": "#93c5fd", "line-width": 2.5, "line-opacity": 0.9 } });
      setMapLoaded(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Arc layer — source already exists after load, just update data
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    const data: GeoJSON.Feature = hasUser && hasDest
      ? {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: greatCirclePoints(userLat!, userLon!, destLat!, destLon!),
          },
          properties: {},
        }
      : { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} };
    (map.getSource("arc") as maplibregl.GeoJSONSource).setData(data);
  }, [mapLoaded, hasUser, hasDest, userLat, userLon, destLat, destLon]);

  // Radius layer — source already exists after load, just update data
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    const coords = hasUser && radiusKm
      ? geodesicCircle(userLat!, userLon!, radiusKm)
      : [];
    const data: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties: {},
    };
    (map.getSource("radius") as maplibregl.GeoJSONSource).setData(data);
  }, [mapLoaded, hasUser, userLat, userLon, radiusKm]);

  // User marker
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    userMarkerRef.current?.remove();
    if (hasUser) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        width: "12px", height: "12px", borderRadius: "50%",
        background: "#93c5fd", border: "2px solid white",
        boxShadow: "0 0 6px rgba(0,0,0,0.5)",
      });
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userLon!, userLat!])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(userLabel || "You are here"))
        .addTo(map);
    }
  }, [mapLoaded, hasUser, userLat, userLon, userLabel]);

  // Destination marker
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    destMarkerRef.current?.remove();
    if (hasDest) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        width: "12px", height: "12px", borderRadius: "50%",
        background: "#fbbf24", border: "2px solid white",
        boxShadow: "0 0 6px rgba(0,0,0,0.5)",
      });
      destMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([destLon!, destLat!])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(destName || "Destination"))
        .addTo(map);
    }
  }, [mapLoaded, hasDest, destLat, destLon, destName]);

  // Place markers within radius
  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map) return;
    placeMarkersRef.current.forEach((m) => m.remove());
    placeMarkersRef.current = [];
    if (radiusPlaces && radiusPlaces.length > 0) {
      for (const p of radiusPlaces) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;";
        const dot = document.createElement("div");
        Object.assign(dot.style, {
          width: "8px", height: "8px", borderRadius: "50%",
          background: "#86efac", border: "1.5px solid white",
          boxShadow: "0 0 4px rgba(0,0,0,0.4)", flexShrink: "0",
        });
        const label = document.createElement("div");
        label.textContent = p.name;
        Object.assign(label.style, {
          fontSize: "10px", fontWeight: "600", color: "#86efac",
          textShadow: "0 1px 3px rgba(0,0,0,0.9)", whiteSpace: "nowrap",
          pointerEvents: "none", lineHeight: "1",
        });
        el.appendChild(dot);
        el.appendChild(label);
        const marker = new maplibregl.Marker({ element: el, anchor: "top" })
          .setLngLat([p.lon, p.lat])
          .addTo(map);
        placeMarkersRef.current.push(marker);
      }
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
      <button
        onClick={onBackToGlobe}
        className="absolute top-3 left-3 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-black/70 border border-white/20 text-white hover:bg-black/90 transition-colors backdrop-blur-sm z-10 select-none"
      >
        🌍 Globe view
      </button>
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

// ─── 3D Globe view ───────────────────────────────────────────────────────────

function GlobeInner({
  userLat, userLon, destLat, destLon, radiusMiles, destName,
  userLabel = "You are here", pickMode, onPickLocation, radiusPlaces,
}: GlobeMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [globeWidth, setGlobeWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef({ userLat, userLon, destLat, destLon, radiusMiles });
  liveRef.current = { userLat, userLon, destLat, destLon, radiusMiles };

  const [mapMode, setMapMode] = useState(false);
  const [mapCenter, setMapCenter] = useState({ lat: 30, lng: 15, zoom: 5 });

  const hasUser = userLat !== undefined && userLon !== undefined;
  const hasDest = destLat !== undefined && destLon !== undefined;
  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setGlobeWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setGlobeWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitCamera = useCallback(() => {
    if (!globeRef.current) return;
    const { userLat, userLon, destLat, destLon, radiusMiles } = liveRef.current;
    const hasUser = userLat !== undefined && userLon !== undefined;
    const hasDest = destLat !== undefined && destLon !== undefined;
    const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;
    if (!hasUser) {
      globeRef.current.pointOfView({ lat: 30, lng: 15, altitude: 2.5 }, 800);
      return;
    }
    let lat: number, lng: number, altitude: number;
    if (hasDest && destLat !== undefined && destLon !== undefined) {
      lat = (userLat! + destLat) / 2;
      lng = (userLon! + destLon) / 2;
      const distKm = haversineKm(userLat!, userLon!, destLat, destLon);
      altitude = Math.max(0.5, Math.min(3.5, distKm / 5000));
    } else if (radiusKm) {
      lat = userLat!; lng = userLon!;
      altitude = Math.max(0.1, Math.min(2.5, radiusKm / 2000));
    } else {
      lat = userLat!; lng = userLon!; altitude = 1.5;
    }
    globeRef.current.pointOfView({ lat, lng, altitude }, 800);
  }, []);

  const trigger = `${userLat ?? ""},${userLon ?? ""}|${destLat ?? ""},${destLon ?? ""}|${radiusKm ?? ""}`;
  const prevTrigger = useRef("");
  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fitCamera, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [trigger, fitCamera]);

  const switchToMap = useCallback(() => {
    if (!globeRef.current) return;
    const pov = globeRef.current.pointOfView();
    // Convert altitude to approximate MapLibre zoom
    const zoom = Math.max(4, Math.min(13, Math.round(9 - Math.log2(pov.altitude * 10))));
    setMapCenter({ lat: pov.lat, lng: pov.lng, zoom });
    setMapMode(true);
  }, []);

  const handleZoom = useCallback((factor: number) => {
    if (!globeRef.current) return;
    const pov = globeRef.current.pointOfView();
    const newAlt = Math.max(0.02, Math.min(5, pov.altitude * factor));
    if (newAlt < MAP_THRESHOLD) {
      switchToMap();
      return;
    }
    globeRef.current.pointOfView({ ...pov, altitude: newAlt }, 300);
  }, [switchToMap]);

  const arcsData = useMemo(
    () => hasUser && hasDest
      ? [{ startLat: userLat!, startLng: userLon!, endLat: destLat!, endLng: destLon! }]
      : [],
    [hasUser, hasDest, userLat, userLon, destLat, destLon]
  );

  // labelData: only user + dest — globe text sprites are expensive; airports shown as dots only
  const labelData = useMemo(() => {
    const pts: { lat: number; lng: number; text: string; color: string }[] = [];
    if (hasUser) pts.push({ lat: userLat!, lng: userLon!, text: userLabel, color: "#93c5fd" });
    if (hasDest) pts.push({ lat: destLat!, lng: destLon!, text: destName || "Destination", color: "#fbbf24" });
    return pts;
  }, [hasUser, hasDest, userLat, userLon, destLat, destLon, userLabel, destName]);

  // pointData: user + dest + airport dots
  const pointData = useMemo(() => {
    const pts: { lat: number; lng: number; color: string }[] = [...labelData];
    if (radiusPlaces) {
      for (const p of radiusPlaces) {
        pts.push({ lat: p.lat, lng: p.lon, color: "#86efac" });
      }
    }
    return pts;
  }, [labelData, radiusPlaces]);

  const polygonsData = useMemo(() => {
    if (!radiusKm || !hasUser) return [];
    return [{
      geometry: {
        type: "Polygon" as const,
        coordinates: [geodesicCircle(userLat!, userLon!, radiusKm)],
      },
    }];
  }, [hasUser, userLat, userLon, radiusKm]);

  const handleGlobeClick = useCallback((
    coords: { lat: number; lng: number; altitude: number }
  ) => {
    if (pickMode && onPickLocation) onPickLocation(coords.lat, coords.lng);
  }, [pickMode, onPickLocation]);

  if (mapMode) {
    return (
      <MapView
        centerLat={mapCenter.lat}
        centerLng={mapCenter.lng}
        initialZoom={mapCenter.zoom}
        userLat={userLat}
        userLon={userLon}
        destLat={destLat}
        destLon={destLon}
        radiusMiles={radiusMiles}
        destName={destName}
        userLabel={userLabel}
        pickMode={pickMode}
        onPickLocation={onPickLocation}
        onBackToGlobe={() => setMapMode(false)}
        radiusPlaces={radiusPlaces}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/30 shadow-2xl bg-black relative"
      style={{ height: 500, cursor: pickMode ? "crosshair" : "default" }}
    >
      {globeWidth > 0 && (
        <Globe
          ref={globeRef}
          width={globeWidth}
          height={500}
          onGlobeReady={fitCamera}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          atmosphereColor="#6baeff"
          atmosphereAltitude={0.2}
          arcsData={arcsData}
          arcColor={() => "rgba(147,197,253,0.75)"}
          arcAltitude={0.008}
          arcDashLength={1}
          arcDashGap={0}
          arcDashAnimateTime={0}
          arcStroke={0.5}
          pointsData={pointData}
          pointLat="lat"
          pointLng="lng"
          pointColor="color"
          pointRadius={0.5}
          pointAltitude={0.01}
          pointResolution={12}
          labelsData={labelData}
          labelLat="lat"
          labelLng="lng"
          labelText="text"
          labelColor={(d: any) => d.color}
          labelSize={0.6}
          labelAltitude={0.01}
          labelResolution={3}
          labelDotRadius={0}
          polygonsData={polygonsData}
          polygonGeoJsonGeometry={(d: any) => d.geometry}
          polygonCapColor={() => "rgba(251,191,36,0.28)"}
          polygonSideColor={() => "rgba(0,0,0,0)"}
          polygonStrokeColor={() => "rgba(251,191,36,0.9)"}
          polygonAltitude={0.005}
          onZoom={(pov: { lat: number; lng: number; altitude: number }) => {
            if (pov.altitude < MAP_THRESHOLD) switchToMap();
          }}
          onGlobeClick={handleGlobeClick}
          enablePointerInteraction
        />
      )}
      {/* Zoom / view controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10 pointer-events-auto">
        <button
          onClick={() => handleZoom(0.6)}
          className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white text-lg font-bold flex items-center justify-center hover:bg-black/80 transition-colors backdrop-blur-sm select-none"
          title="Zoom in"
        >+</button>
        <button
          onClick={() => handleZoom(1 / 0.6)}
          className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white text-lg font-bold flex items-center justify-center hover:bg-black/80 transition-colors backdrop-blur-sm select-none"
          title="Zoom out"
        >−</button>
        <button
          onClick={fitCamera}
          className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white text-xs flex items-center justify-center hover:bg-black/80 transition-colors backdrop-blur-sm select-none"
          title="Reset view"
        >⊙</button>
        <button
          onClick={switchToMap}
          className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white text-base flex items-center justify-center hover:bg-black/80 transition-colors backdrop-blur-sm select-none"
          title="Switch to map view"
        >🗺</button>
      </div>
      {/* Pick-mode overlay hint */}
      {pickMode && (
        <div className="absolute inset-0 pointer-events-none flex items-start justify-center pt-4">
          <div className="bg-black/70 text-white text-sm font-semibold px-4 py-2 rounded-full backdrop-blur-sm">
            Click anywhere on the map to set {pickMode === "from" ? "start" : "destination"}
          </div>
        </div>
      )}
      {/* Pick buttons */}
    </div>
  );
}

export default function GlobeMap(props: GlobeMapProps) {
  const [webglOk] = useState(() => hasWebGL());
  if (!webglOk) return <NoWebGLFallback />;
  return (
    <GlobeErrorBoundary>
      <GlobeInner {...props} />
    </GlobeErrorBoundary>
  );
}
