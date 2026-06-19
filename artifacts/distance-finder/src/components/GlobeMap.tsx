import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import { haversineKm } from "@/lib/geo";

interface GlobeMapProps {
  userLat: number;
  userLon: number;
  destLat?: number;
  destLon?: number;
  radiusMiles?: number;
  destName?: string;
  userLabel?: string;
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

export default function GlobeMap({
  userLat,
  userLon,
  destLat,
  destLon,
  radiusMiles,
  destName,
  userLabel = "You are here",
}: GlobeMapProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [globeWidth, setGlobeWidth] = useState(600);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef({ userLat, userLon, destLat, destLon, radiusMiles });
  liveRef.current = { userLat, userLon, destLat, destLon, radiusMiles };

  const hasDest = destLat !== undefined && destLon !== undefined;
  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setGlobeWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      setGlobeWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitCamera = useCallback(() => {
    if (!globeRef.current) return;
    const { userLat, userLon, destLat, destLon, radiusMiles } = liveRef.current;
    const hasDest = destLat !== undefined && destLon !== undefined;
    const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

    let lat: number, lng: number, altitude: number;

    if (hasDest && destLat !== undefined && destLon !== undefined) {
      lat = (userLat + destLat) / 2;
      lng = (userLon + destLon) / 2;
      const distKm = haversineKm(userLat, userLon, destLat, destLon);
      altitude = Math.max(0.5, Math.min(3.5, distKm / 5000));
    } else if (radiusKm) {
      lat = userLat;
      lng = userLon;
      altitude = Math.max(0.1, Math.min(2.5, radiusKm / 2000));
    } else {
      lat = userLat;
      lng = userLon;
      altitude = 1.5;
    }

    globeRef.current.pointOfView({ lat, lng, altitude }, 800);
  }, []);

  const trigger = `${userLat},${userLon}|${destLat ?? ""},${destLon ?? ""}|${radiusKm ?? ""}`;
  const prevTrigger = useRef("");

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fitCamera, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [trigger, fitCamera]);

  const arcsData = useMemo(
    () =>
      hasDest
        ? [{ startLat: userLat, startLng: userLon, endLat: destLat!, endLng: destLon! }]
        : [],
    [userLat, userLon, destLat, destLon, hasDest]
  );

  const labelsData = useMemo(
    () => [
      { lat: userLat, lng: userLon, text: userLabel, labelType: "user" },
      ...(hasDest
        ? [{ lat: destLat!, lng: destLon!, text: destName || "Destination", labelType: "dest" }]
        : []),
    ],
    [userLat, userLon, destLat, destLon, hasDest, userLabel, destName]
  );

  const polygonsData = useMemo(() => {
    if (!radiusKm) return [];
    return [
      {
        geometry: {
          type: "Polygon" as const,
          coordinates: [geodesicCircle(userLat, userLon, radiusKm)],
        },
      },
    ];
  }, [userLat, userLon, radiusKm]);

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/50 shadow-xl bg-black"
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
          atmosphereColor="#1e40af"
          atmosphereAltitude={0.25}
          arcsData={arcsData}
          arcColor={() => ["#93c5fd", "#fbbf24"]}
          arcAltitudeAutoScale={0.35}
          arcDashLength={0.5}
          arcDashGap={0.3}
          arcDashAnimateTime={2500}
          arcStroke={1.5}
          labelsData={labelsData}
          labelLat="lat"
          labelLng="lng"
          labelText="text"
          labelColor={(d: any) => (d.labelType === "user" ? "#93c5fd" : "#fbbf24")}
          labelSize={1.2}
          labelDotRadius={0.5}
          labelDotOrientation={() => "bottom" as const}
          labelAltitude={0.015}
          polygonsData={polygonsData}
          polygonGeoJsonGeometry={(d: any) => d.geometry}
          polygonFillColor={() => "rgba(96,165,250,0.18)"}
          polygonStrokeColor={() => "#60a5fa"}
          polygonAltitude={0.005}
          enablePointerInteraction
        />
      )}
    </div>
  );
}
