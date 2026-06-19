import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Circle, Tooltip, useMap } from "react-leaflet";
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

// Raw geodesic circle points — no longitude unwrapping. Used for both the
// fill polygon (raw coords) and the outline polyline (after unwrapping).
function geodesicCircleRaw(lat: number, lon: number, radiusKm: number, steps = 360): [number, number][] {
  const R = 6371;
  const d = radiusKm / R;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);

  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = toRad((i * 360) / steps);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
    );
    pts.push([toDeg(φ2), toDeg(λ2)]);
  }
  return pts;
}

// True if any consecutive longitude jump exceeds 180° (circle crosses ±180°).
function circleCoversAntimeridian(pts: [number, number][]): boolean {
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][1] - pts[i - 1][1]) > 180) return true;
  }
  return false;
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

    if (destLat !== undefined && destLon !== undefined) {
      // Fit both points (+ radius padding)
      let bounds = L.latLngBounds([[userLat, userLon], [destLat, destLon]]);
      if (radiusKm) {
        const degLat = (radiusKm / 6371) * (180 / Math.PI);
        const degLon = degLat / Math.max(Math.cos((userLat * Math.PI) / 180), 0.01);
        bounds = bounds.extend([userLat + degLat, userLon - degLon]);
        bounds = bounds.extend([userLat - degLat, userLon + degLon]);
      }
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 3 });
    } else if (radiusKm) {
      // Fit around user + radius circle
      const degLat = (radiusKm / 6371) * (180 / Math.PI);
      const degLon = degLat / Math.max(Math.cos((userLat * Math.PI) / 180), 0.01);
      const bounds = L.latLngBounds([
        [userLat - degLat, userLon - degLon],
        [userLat + degLat, userLon + degLon],
      ]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
    } else {
      // Just user location — zoom in moderately
      map.setView([userLat, userLon], 5);
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
}

export default function DistanceMap({ userLat, userLon, destLat, destLon, radiusMiles, destName }: DistanceMapProps) {
  const hasDest = destLat !== undefined && destLon !== undefined;
  const center: [number, number] = hasDest
    ? [(userLat + destLat!) / 2, (userLon + destLon!) / 2]
    : [userLat, userLon];

  const arc = hasDest ? greatCirclePath(userLat, userLon, destLat!, destLon!) : null;

  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;
  // Raw points used for the fill Polygon (no unwrapping = correct closure for
  // non-antimeridian circles). Unwrapped points used for the outline Polyline.
  const circleRaw = radiusKm ? geodesicCircleRaw(userLat, userLon, radiusKm) : null;
  const circleOutline = circleRaw ? unwrapLons(circleRaw) : null;
  const wrapsFill = circleRaw ? circleCoversAntimeridian(circleRaw) : false;

  const lineStyle = { color: "#2563eb", weight: 2.5, opacity: 0.7, dashArray: "6 6" };
  const circleStyle = { color: "#2563eb", weight: 2, opacity: 0.85 };

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

        {/* Fill: geodesic Polygon aligns exactly with the outline.
            Falls back to native Circle only when the circle crosses ±180°. */}
        {circleRaw && !wrapsFill && (
          <Polygon
            positions={circleRaw}
            pathOptions={{ stroke: false, fillColor: "#2563eb", fillOpacity: 0.1 }}
          />
        )}
        {radiusKm && wrapsFill && (
          <Circle
            center={[userLat, userLon]}
            radius={radiusKm * 1000}
            pathOptions={{ stroke: false, fillColor: "#2563eb", fillOpacity: 0.1 }}
          />
        )}

        {/* Geodesic outline — unwrapped lons for smooth antimeridian arc */}
        {circleOutline && (
          <Polyline positions={circleOutline} pathOptions={circleStyle} />
        )}

        <Marker position={[userLat, userLon]} icon={userIcon}>
          <Tooltip
            permanent
            direction="top"
            offset={[0, -10]}
            className="map-label map-label--user"
          >
            You are here
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
