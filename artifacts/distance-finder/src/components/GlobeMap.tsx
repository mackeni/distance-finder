import React, { useRef, useEffect, useState, useMemo, useCallback, Component } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import { haversineKm } from "@/lib/geo";

interface GlobeMapProps {
  userLat?: number;
  userLon?: number;
  destLat?: number;
  destLon?: number;
  radiusMiles?: number;
  destName?: string;
  userLabel?: string;
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

function geodesicCircle(lat: number, lon: number, radiusKm: number, steps = 128): number[][] {
  const d = radiusKm / 6371.0088;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const coords: number[][] = [];
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

function makeLabel(text: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "pointer-events:none",
    "white-space:nowrap",
    "font-family:system-ui,-apple-system,sans-serif",
    "font-size:11px",
    "font-weight:700",
    "letter-spacing:0.03em",
    `color:${color}`,
    "text-shadow:0 1px 6px rgba(0,0,0,0.95),0 0 12px rgba(0,0,0,0.8)",
    "padding-left:10px",
  ].join(";");
  el.textContent = text;
  return el;
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

function NoWebGLFallback() {
  return (
    <div
      data-testid="map-container"
      className="w-full rounded-3xl border border-border/30 bg-card/40 flex flex-col items-center justify-center gap-3 text-center px-8"
      style={{ height: 500 }}
    >
      <span className="text-4xl">🌍</span>
      <p className="text-muted-foreground font-medium">
        3D globe requires WebGL
      </p>
      <p className="text-sm text-muted-foreground/60">
        Available in Chrome, Firefox, Safari, and most mobile browsers.
      </p>
    </div>
  );
}

function GlobeInner({
  userLat, userLon, destLat, destLon, radiusMiles, destName, userLabel = "You are here",
}: GlobeMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [globeWidth, setGlobeWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef({ userLat, userLon, destLat, destLon, radiusMiles });
  liveRef.current = { userLat, userLon, destLat, destLon, radiusMiles };

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

  const arcsData = useMemo(
    () => hasUser && hasDest
      ? [{ startLat: userLat!, startLng: userLon!, endLat: destLat!, endLng: destLon! }]
      : [],
    [hasUser, hasDest, userLat, userLon, destLat, destLon]
  );

  const htmlLabels = useMemo(() => {
    const pts: { lat: number; lng: number; text: string; color: string }[] = [];
    if (hasUser) pts.push({ lat: userLat!, lng: userLon!, text: userLabel, color: "#93c5fd" });
    if (hasDest) pts.push({ lat: destLat!, lng: destLon!, text: destName || "Destination", color: "#fbbf24" });
    return pts;
  }, [hasUser, hasDest, userLat, userLon, destLat, destLon, userLabel, destName]);

  const polygonsData = useMemo(() => {
    if (!radiusKm || !hasUser) return [];
    return [{ geometry: { type: "Polygon" as const, coordinates: [geodesicCircle(userLat!, userLon!, radiusKm)] } }];
  }, [hasUser, userLat, userLon, radiusKm]);

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/30 shadow-2xl bg-black"
      style={{ height: 500 }}
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
          arcColor={() => "rgba(147,197,253,0.7)"}
          arcAltitude={0}
          arcDashLength={1}
          arcDashGap={0}
          arcDashAnimateTime={0}
          arcStroke={0.5}
          pointsData={htmlLabels}
          pointLat="lat"
          pointLng="lng"
          pointColor="color"
          pointRadius={0.35}
          pointAltitude={0}
          pointResolution={12}
          htmlElementsData={htmlLabels}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0}
          htmlElement={(d: any) => makeLabel(d.text, d.color)}
          polygonsData={polygonsData}
          polygonGeoJsonGeometry={(d: any) => d.geometry}
          polygonCapColor={() => "rgba(251,191,36,0.14)"}
          polygonSideColor={() => "rgba(0,0,0,0)"}
          polygonStrokeColor={() => "rgba(251,191,36,0.6)"}
          polygonAltitude={0.005}
          enablePointerInteraction
        />
      )}
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
