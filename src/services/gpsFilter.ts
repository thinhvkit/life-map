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

class GPSFilter {
  private lastAccepted: RawPoint | null = null;
  private config: FilterConfig = ACTIVITY_CONFIGS.unknown;
  private currentActivity: ActivityType = 'unknown';
  private rejectedCount = 0;

  setActivity(activity: ActivityType): void {
    if (activity === this.currentActivity) return;
    this.currentActivity = activity;
    this.config = ACTIVITY_CONFIGS[activity] || ACTIVITY_CONFIGS.unknown;
  }

  process(point: RawPoint): FilterResult {
    // 1. Accuracy gate — reject very inaccurate readings
    if (point.accuracy > this.config.maxAccuracy) {
      this.rejectedCount++;
      return { accepted: false, reason: 'accuracy', ...point };
    }

    if (this.lastAccepted) {
      const dt = point.timestamp - this.lastAccepted.timestamp;

      // 2. Time delta gate — skip too-frequent updates
      if (dt < this.config.minTimeDelta) {
        return { accepted: false, reason: 'too_frequent', ...point };
      }

      // 3. Speed gate — reject teleport spikes
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

    // Accept raw coordinates — no Kalman smoothing
    this.lastAccepted = point;
    this.rejectedCount = 0;

    return {
      accepted: true,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
      timestamp: point.timestamp,
    };
  }

  reset(): void {
    this.lastAccepted = null;
    this.rejectedCount = 0;
  }

  getConsecutiveRejections(): number {
    return this.rejectedCount;
  }
}

export const gpsFilter = new GPSFilter();
