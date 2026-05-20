import { GPSPoint, GPSRoute, AnomalyResult, RouteStatus } from "@movenrun/shared";

const MAX_SPEED_MS = 22; // ~80 km/h — max plausible running/cycling speed
const MIN_ACCURACY_M = 50;
const MIN_POINTS = 10;

export class GpsService {
  validateRoute(route: GPSRoute): AnomalyResult {
    const reasons: string[] = [];

    if (route.points.length < MIN_POINTS) {
      reasons.push(`Too few GPS points: ${route.points.length}`);
    }

    // Check for teleportation (unrealistic speed between consecutive points)
    for (let i = 1; i < route.points.length; i++) {
      const prev = route.points[i - 1];
      const curr = route.points[i];
      const dt = (curr.timestamp - prev.timestamp) / 1000; // seconds
      if (dt <= 0) { reasons.push(`Non-monotonic timestamps at index ${i}`); continue; }

      const dist = this._haversine(prev.lat, prev.lng, curr.lat, curr.lng);
      const speed = dist / dt;
      if (speed > MAX_SPEED_MS) {
        reasons.push(`Implausible speed at index ${i}: ${speed.toFixed(1)} m/s`);
      }
    }

    // Check accuracy — flag poor GPS
    const poorAccuracy = route.points.filter((p) => p.accuracy > MIN_ACCURACY_M);
    if (poorAccuracy.length > route.points.length * 0.3) {
      reasons.push(`>30% points have accuracy > ${MIN_ACCURACY_M}m`);
    }

    // Check total duration sanity
    const durationHours = (route.endTime - route.startTime) / 3_600_000;
    if (durationHours > 24) reasons.push("Route duration exceeds 24 hours");

    return {
      isAnomaly: reasons.length > 0,
      reasons,
      confidence: reasons.length === 0 ? 0.95 : 0.2,
    };
  }

  calculateDistance(points: GPSPoint[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += this._haversine(
        points[i - 1].lat, points[i - 1].lng,
        points[i].lat,     points[i].lng
      );
    }
    return total;
  }

  buildRouteHash(route: GPSRoute): string {
    const { createHash } = require("crypto");
    const payload = JSON.stringify({
      walletAddress: route.walletAddress,
      points: route.points.map((p) => [p.lat, p.lng, p.timestamp]),
      startTime: route.startTime,
      endTime: route.endTime,
    });
    return "0x" + createHash("sha256").update(payload).digest("hex");
  }

  private _haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000; // Earth radius in meters
    const dLat = this._deg2rad(lat2 - lat1);
    const dLng = this._deg2rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this._deg2rad(lat1)) * Math.cos(this._deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private _deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
