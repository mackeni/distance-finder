import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMap } from "react-leaflet";
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

function greatCircleSegments(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  steps = 100
): [number, number][][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1), λ1 = toRad(lon1);
  const φ2 = toRad(lat2), λ2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));
  const raw: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const φ = Math.atan2(z, Math.sqrt(x ** 2 + y ** 2));
    const λ = Math.atan2(y, x);
    raw.push([toDeg(φ), toDeg(λ)]);
  }
  const segments: [number, number][][] = [];
  let current: [number, number][] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (Math.abs(raw[i][1] - raw[i - 1][1]) > 180) {
      segments.push(current);
      current = [raw[i]];
    } else {
      current.push(raw[i]);
    }
  }
  segments.push(current);
  return segments;
}

// Geodesic circle: compute points at `radiusKm` distance in every direction
function geodesicCirclePoints(lat: number, lon: number, radiusKm: number, steps = 360): [number, number][] {
  const R = 6371;
  const d = radiusKm / R;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = toRad((i * 360) / steps);
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ)
    );
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
    );
    points.push([toDeg(φ2), toDeg(λ2)]);
  }
  return points;
}

interface FitBoundsProps {
  markerPositions: [number, number][];
  radiusKm?: number;
  userLat?: number;
  userLon?: number;
}

function FitBounds({ markerPositions, radiusKm, userLat, userLon }: FitBoundsProps) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!fitted.current && markerPositions.length >= 1) {
      let bounds = L.latLngBounds(markerPositions);
      if (radiusKm && userLat !== undefined && userLon !== undefined) {
        const degLat = (radiusKm / 6371) * (180 / Math.PI);
        const degLon = degLat / Math.cos((userLat * Math.PI) / 180);
        bounds = bounds.extend([userLat + degLat, userLon - degLon]);
        bounds = bounds.extend([userLat - degLat, userLon + degLon]);
      }
      // maxZoom: 3 keeps a global perspective so the arc's curvature is visible
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 3 });
      fitted.current = true;
    }
  }, [map, markerPositions, radiusKm, userLat, userLon]);

  return null;
}

interface DistanceMapProps {
  userLat: number;
  userLon: number;
  destLat: number;
  destLon: number;
  radiusMiles?: number;
}

export default function DistanceMap({ userLat, userLon, destLat, destLon, radiusMiles }: DistanceMapProps) {
  const center: [number, number] = [(userLat + destLat) / 2, (userLon + destLon) / 2];
  const markerPositions: [number, number][] = [[userLat, userLon], [destLat, destLon]];
  const arcSegments = greatCircleSegments(userLat, userLon, destLat, destLon);

  const radiusKm = radiusMiles ? radiusMiles * 1.60934 : undefined;
  const circlePoints = radiusKm ? geodesicCirclePoints(userLat, userLon, radiusKm) : null;

  const lineStyle = { color: "#2563eb", weight: 2.5, opacity: 0.6, dashArray: "6 6" };
  const circleStyle = { color: "#2563eb", weight: 2, opacity: 0.8, fillColor: "#2563eb", fillOpacity: 0.08 };

  return (
    <div
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/50 shadow-xl"
      style={{ height: "500px" }}
    >
      <MapContainer
        center={center}
        zoom={2}
        style={{ height: "100%", width: "100%", background: "#f8fafc" }}
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />

        {circlePoints && (
          <Polygon positions={circlePoints} pathOptions={circleStyle} />
        )}

        <Marker position={[userLat, userLon]} icon={userIcon} />
        <Marker position={[destLat, destLon]} icon={destIcon} />

        {arcSegments.map((seg, i) => (
          <Polyline key={i} positions={seg} pathOptions={lineStyle} />
        ))}

        <FitBounds
          markerPositions={markerPositions}
          radiusKm={radiusKm}
          userLat={userLat}
          userLon={userLon}
        />
      </MapContainer>
    </div>
  );
}
