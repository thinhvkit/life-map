import { ActivityType } from '../models/types';

interface RawPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface FilterResult {
  accepted: boolean;
  reason?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface FilterConfig {
  maxAccuracy: number;  // meters — reject above this
  maxSpeed: number;     // m/s — reject implied speed above this
  minTimeDelta: number; // ms — skip too-frequent updates
}

const ACTIVITY_CONFIGS: Record<string, FilterConfig> = {
  stationary: { maxAccuracy: 50, maxSpeed: 3,   minTimeDelta: 3000 },
  walking:    { maxAccuracy: 50, maxSpeed: 8,   minTimeDelta: 1500 },
  running:    { maxAccuracy: 50, maxSpeed: 15,  minTimeDelta: 1000 },
  cycling:    { maxAccuracy: 60, maxSpeed: 35,  minTimeDelta: 1000 },
  automotive: { maxAccuracy: 80, maxSpeed: 80,  minTimeDelta: 500 },
  unknown:    { maxAccuracy: 60, maxSpeed: 60,  minTimeDelta: 1000 },
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 1-degree latitude ≈ 111,320 meters
const DEG_TO_M = 111_320;

class KalmanAxis {
  private x = 0;   // position estimate (degrees)
  private v = 0;   // velocity estimate (degrees/s)
  private p00 = 1; // covariance: position variance
  private p01 = 0; // covariance: position-velocity
  private p10 = 0;
  private p11 = 1; // covariance: velocity variance
  private initialized = false;

  reset(): void {
    this.initialized = false;
    this.x = 0;
    this.v = 0;
    this.p00 = 1;
    this.p01 = 0;
    this.p10 = 0;
    this.p11 = 1;
  }

  update(measurement: number, accuracyM: number, dtSec: number): number {
    if (!this.initialized) {
      this.x = measurement;
      this.v = 0;
      const accDeg = accuracyM / DEG_TO_M;
      this.p00 = accDeg * accDeg;
      this.p01 = 0;
      this.p10 = 0;
      this.p11 = 1e-8;
      this.initialized = true;
      return this.x;
    }

    // Process noise scales with dt — faster movement = more uncertainty
    const qPos = (3 / DEG_TO_M) ** 2 * dtSec;  // ~3 m/s walking noise
    const qVel = (1 / DEG_TO_M) ** 2 * dtSec;

    // Predict
    this.x += this.v * dtSec;
    this.p00 += dtSec * (this.p10 + this.p01) + dtSec * dtSec * this.p11 + qPos;
    this.p01 += dtSec * this.p11;
    this.p10 += dtSec * this.p11;
    this.p11 += qVel;

    // Measurement noise from GPS accuracy
    const rDeg = accuracyM / DEG_TO_M;
    const r = rDeg * rDeg;

    // Kalman gain
    const s = this.p00 + r;
    const k0 = this.p00 / s;
    const k1 = this.p10 / s;

    // Update
    const innovation = measurement - this.x;
    this.x += k0 * innovation;
    this.v += k1 * innovation;

    const p00New = (1 - k0) * this.p00;
    const p01New = (1 - k0) * this.p01;
    this.p10 = -k1 * this.p00 + this.p10;
    this.p11 = -k1 * this.p01 + this.p11;
    this.p00 = p00New;
    this.p01 = p01New;

    return this.x;
  }
}

class GPSFilter {
  private lastAccepted: RawPoint | null = null;
  private config: FilterConfig = ACTIVITY_CONFIGS.unknown;
  private currentActivity: ActivityType = 'unknown';
  private rejectedCount = 0;
  private kalmanLat = new KalmanAxis();
  private kalmanLon = new KalmanAxis();

  setActivity(activity: ActivityType): void {
    if (activity === this.currentActivity) return;
    this.currentActivity = activity;
    this.config = ACTIVITY_CONFIGS[activity] || ACTIVITY_CONFIGS.unknown;
  }

  process(point: RawPoint): FilterResult {
    // 1. Accuracy gate
    if (point.accuracy > this.config.maxAccuracy) {
      this.rejectedCount++;
      return { accepted: false, reason: 'accuracy', ...point };
    }

    if (this.lastAccepted) {
      const dt = point.timestamp - this.lastAccepted.timestamp;

      // 2. Time delta gate
      if (dt < this.config.minTimeDelta) {
        return { accepted: false, reason: 'too_frequent', ...point };
      }

      // 3. Speed gate — reject teleport spikes (use raw coords for spike detection)
      if (dt > 0) {
        const dist = haversine(
          this.lastAccepted.latitude, this.lastAccepted.longitude,
          point.latitude, point.longitude,
        );
        const speed = dist / (dt / 1000);
        if (speed > this.config.maxSpeed) {
          this.rejectedCount++;
          return { accepted: false, reason: 'speed', ...point };
        }
      }
    }

    // Kalman-smooth accepted coordinates
    const dtSec = this.lastAccepted
      ? Math.max((point.timestamp - this.lastAccepted.timestamp) / 1000, 0.1)
      : 0;

    const smoothLat = this.kalmanLat.update(point.latitude, point.accuracy, dtSec);
    const smoothLon = this.kalmanLon.update(point.longitude, point.accuracy, dtSec);

    this.lastAccepted = point;
    this.rejectedCount = 0;

    return {
      accepted: true,
      latitude: smoothLat,
      longitude: smoothLon,
      accuracy: point.accuracy,
      timestamp: point.timestamp,
    };
  }

  reset(): void {
    this.lastAccepted = null;
    this.rejectedCount = 0;
    this.kalmanLat.reset();
    this.kalmanLon.reset();
  }

  getConsecutiveRejections(): number {
    return this.rejectedCount;
  }
}

export const gpsFilter = new GPSFilter();
