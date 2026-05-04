import { ActivityType } from '../models/types';

export function classifyActivity(
  rawActivity: string,
  confidence: number,
): ActivityType {
  if (confidence < 50) return 'unknown';

  const map: Record<string, ActivityType> = {
    still: 'stationary',
    walking: 'walking',
    running: 'running',
    on_foot: 'walking',
    on_bicycle: 'cycling',
    in_vehicle: 'driving',
    tilting: 'unknown',
    unknown: 'unknown',
  };

  return map[rawActivity.toLowerCase()] || 'unknown';
}

export function classifyBySpeed(speedMs: number): ActivityType {
  if (speedMs < 0.5) return 'stationary';
  if (speedMs < 2.5) return 'walking';
  if (speedMs < 6) return 'running';
  if (speedMs < 12) return 'cycling';
  if (speedMs < 30) return 'driving';
  return 'train';
}

export function mergeClassifications(
  sensorActivity: ActivityType,
  sensorConfidence: number,
  speedMs: number,
): ActivityType {
  if (sensorConfidence >= 75) return sensorActivity;

  const speedActivity = classifyBySpeed(speedMs);
  if (sensorActivity === speedActivity) return sensorActivity;
  if (sensorConfidence >= 50) return sensorActivity;

  return speedActivity;
}
