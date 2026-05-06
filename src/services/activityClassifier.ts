import { ActivityType } from '../models/types';

export function classifyFromSensors(
  speedMs: number,
  accelVariance: number,
): { activity: ActivityType; confidence: number } {
  if (speedMs < 0.5 && accelVariance < 0.05) {
    return { activity: 'stationary', confidence: 90 };
  }
  if (speedMs < 2.5) {
    return { activity: 'walking', confidence: accelVariance > 0.3 ? 85 : 60 };
  }
  if (speedMs < 6 && accelVariance > 0.2) {
    return { activity: 'running', confidence: 75 };
  }
  if (speedMs < 12) {
    return { activity: 'cycling', confidence: accelVariance > 0.1 ? 70 : 50 };
  }
  if (speedMs < 30) {
    return { activity: 'driving', confidence: 70 };
  }
  return { activity: 'train', confidence: 50 };
}

export function classifyBySpeed(speedMs: number): ActivityType {
  if (speedMs < 0.5) return 'stationary';
  if (speedMs < 2.5) return 'walking';
  if (speedMs < 6) return 'running';
  if (speedMs < 12) return 'cycling';
  if (speedMs < 30) return 'driving';
  return 'train';
}
