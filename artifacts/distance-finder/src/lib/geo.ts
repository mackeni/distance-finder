export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

export function getCompassDirection(bearing: number): string {
  const directions = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

/** Distance in km purely along the north–south axis (same meridian). */
export function northSouthKm(lat1: number, lon1: number, lat2: number): number {
  return haversineKm(lat1, lon1, lat2, lon1);
}

/** N or S direction label. */
export function northSouthDir(lat1: number, lat2: number): string {
  return lat2 >= lat1 ? "N" : "S";
}

/**
 * Distance in km purely along the east–west axis at the destination latitude.
 * Uses the shorter path around the globe.
 */
export function eastWestKm(lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat2, lon1, lat2, lon2);
}

/** E or W direction label (shortest arc). */
export function eastWestDir(lon1: number, lon2: number): string {
  const dLon = ((lon2 - lon1 + 540) % 360) - 180;
  return dLon >= 0 ? "E" : "W";
}
