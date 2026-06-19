import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
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

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!fitted.current && positions.length === 2) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [48, 48] });
      fitted.current = true;
    }
  }, [map, positions]);

  return null;
}

interface DistanceMapProps {
  userLat: number;
  userLon: number;
  destLat: number;
  destLon: number;
}

export default function DistanceMap({ userLat, userLon, destLat, destLon }: DistanceMapProps) {
  const center: [number, number] = [
    (userLat + destLat) / 2,
    (userLon + destLon) / 2,
  ];

  const positions: [number, number][] = [
    [userLat, userLon],
    [destLat, destLon],
  ];

  return (
    <div
      data-testid="map-container"
      className="w-full rounded-3xl overflow-hidden border border-border/50 shadow-xl"
      style={{ height: "380px" }}
    >
      <MapContainer
        center={center}
        zoom={4}
        style={{ height: "100%", width: "100%", background: "#0f172a" }}
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />

        <Marker position={[userLat, userLon]} icon={userIcon} />
        <Marker position={[destLat, destLon]} icon={destIcon} />

        <Polyline
          positions={positions}
          pathOptions={{
            color: "#2563eb",
            weight: 2.5,
            opacity: 0.6,
            dashArray: "6 6",
          }}
        />

        <FitBounds positions={positions} />
      </MapContainer>
    </div>
  );
}
