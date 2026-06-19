import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";

const userIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:14px;height:14px;
    background:#2563eb;
    border:2px solid #fff;
    border-radius:50%;
    box-shadow:0 0 0 3px rgba(37,99,235,0.3),0 2px 6px rgba(0,0,0,0.25)
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const destIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:16px;height:16px;
    background:#d97706;
    border:2px solid #fff;
    border-radius:50%;
    box-shadow:0 0 0 3px rgba(217,119,6,0.3),0 2px 6px rgba(0,0,0,0.25)
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function unwrapLons(points: [number, number][]): [number, number][] {
  if (points.length === 0) return [];
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prevLon = out[i - 1][1];
    let lon = points[i][1];
    while (lon - prevLon > 180) lon -= 360;
    while (prevLon - lon > 180) lon += 360;
    out.push([points[i][0], lon]);
  }
  return out;
}

function greatCirclePath(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  steps = 200
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1), λ1 = toRad(lon1);
  const φ2 = toRad(lat2), λ2 = toRad(lon2);

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));

  if (d === 0) return [[lat1, lon1]];

  const raw: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    raw.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }

  return unwrapLons(raw);
}


interface FitBoundsProps {
  userLat: number;
  userLon: number;
  destLat?: number;
  destLon?: number;
  radiusKm?: number;
  trigger: string;
}

function FitBounds({ userLat, userLon, destLat, destLon, radiusKm, trigger }: FitBoundsProps) {
  const map = useMap();
  const prevTrigger = useRef<string>("");

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;

    const PAD: [number, number] = [48, 48];

    // Compute lat/lon extents of the radius circle without needing a map instance.
    // 111.32 km per degree latitude; longitude degrees shrink with cos(lat).
    const radiusBounds = () => {
      if (!radiusKm) return null;
      const dLat = radiusKm / 111.32;
      const dLon = radiusKm / (111.32 * Math.max(Math.cos((userLat * Math.PI) / 180), 0.0001));
      return L.latLngBounds(
        [userLat - dLat, userLon - dLon],
        [userLat + dLat, userLon + dLon],
      );
    };

    if (destLat !== undefined && destLon !== undefined) {
      // Both endpoints — fit them, optionally expanded by the radius circle
      let bounds = L.latLngBounds([[userLat, userLon], [destLat, destLon]]);
      const rb = radiusBounds();
      if (rb) bounds = bounds.extend(rb);
      map.fitBounds(bounds, { padding: PAD, animate: true });
    } else if (radiusKm) {
      // Radius only — fit the circle
      map.fitBounds(radiusBounds()!, { padding: PAD, animate: true });
    } else {
      // User location only
      map.setView([userLat, userLon], 5, { animate: true });
    }
  }, [trigger]);

  return null;
}

interface DistanceMapProps {
  userLat: number;
  userLon: number;
  destLat?: number;
  destLon?: number;
  radiusMiles?: number;
  destName?: string;
  userLabel?: string;
}

export default function DistanceMap({ userLat, userLon, destLat, destLon, radiusMiles, destName, userLabel = "You are here" }: DistanceMapProps) {
  const hasDest = destLat !== undefined && destLon !== undefined;
  const center: [number, number] = hasDest
    ? [(userLat + destLat!) / 2, (userLon + destLon!) / 2]
    : [userLat, userLon];

  const arc = hasDest ? greatCirclePath(userLat, userLon, destLat!, destLon!) : null;

  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;

  const lineStyle = { color: "#2563eb", weight: 2.5, opacity: 0.7, dashArray: "6 6" };

  // Trigger string changes whenever something meaningful is added/changed
  const trigger = `${userLat},${userLon}|${destLat ?? ""},${destLon ?? ""}|${radiusKm ?? ""}`;

  return (
    <div
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/50 shadow-xl"
      style={{ height: "500px" }}
    >
      <MapContainer
        center={center}
        zoom={2}
        worldCopyJump={false}
        style={{ height: "100%", width: "100%", background: "#f8fafc" }}
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
          noWrap={false}
        />

        {/* Single Circle for both fill and stroke — guaranteed to align */}
        {radiusKm && (
          <Circle
            center={[userLat, userLon]}
            radius={radiusKm * 1000}
            pathOptions={{
              color: "#2563eb",
              weight: 2,
              opacity: 0.85,
              fillColor: "#2563eb",
              fillOpacity: 0.1,
            }}
          />
        )}

        <Marker position={[userLat, userLon]} icon={userIcon}>
          <Tooltip
            permanent
            direction="top"
            offset={[0, -10]}
            className="map-label map-label--user"
          >
            {userLabel}
          </Tooltip>
        </Marker>

        {hasDest && (
          <>
            <Marker position={[destLat!, destLon!]} icon={destIcon}>
              {destName && (
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -11]}
                  className="map-label map-label--dest"
                >
                  {destName}
                </Tooltip>
              )}
            </Marker>
            {arc && <Polyline positions={arc} pathOptions={lineStyle} />}
          </>
        )}

        <FitBounds
          userLat={userLat}
          userLon={userLon}
          destLat={destLat}
          destLon={destLon}
          radiusKm={radiusKm}
          trigger={trigger}
        />
      </MapContainer>
    </div>
  );
}
