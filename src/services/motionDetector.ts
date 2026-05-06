import { Accelerometer } from 'expo-sensors';
import {
  activityRecognition,
  NativeActivityEvent,
  NativeActivityType,
} from '../native/ActivityRecognition';
import { ActivityType } from '../models/types';

const ACCEL_BUFFER_SIZE = 50; // 5s at 10Hz
const MOTION_VARIANCE_THRESHOLD = 0.15;
const STATIONARY_VARIANCE_THRESHOLD = 0.05;
const HYSTERESIS_COUNT = 3;
const EVAL_INTERVAL = 500;

const CONFIRMATION_COUNT = 2;
const WINDOW_SIZE = 5;
const EVENT_TTL = 30000;

interface MotionEvent {
  isMoving: boolean;
  timestamp: number;
}

const NATIVE_TO_ACTIVITY: Record<NativeActivityType, ActivityType> = {
  stationary: 'stationary',
  walking: 'walking',
  running: 'running',
  cycling: 'cycling',
  automotive: 'driving',
  unknown: 'unknown',
};

class MotionDetector {
  private useNative = false;
  private motionChangeCallback: ((isMoving: boolean) => void) | null = null;
  private activityChangeCallback:
    | ((activity: ActivityType, confidence: number) => void)
    | null = null;

  // Native state
  private lastNativeActivity: ActivityType = 'unknown';
  private lastNativeConfidence = 0;

  // Accelerometer fallback state
  private accelSubscription: ReturnType<typeof Accelerometer.addListener> | null = null;
  private accelBuffer: number[] = [];
  private currentIsMoving = false;
  private consecutiveMotion = 0;
  private consecutiveStationary = 0;
  private lastEvalTime = 0;

  // Hysteresis event window
  private events: MotionEvent[] = [];

  async start(
    onMotionChange: (isMoving: boolean) => void,
    onActivityChange?: (activity: ActivityType, confidence: number) => void,
  ): Promise<void> {
    this.motionChangeCallback = onMotionChange;
    this.activityChangeCallback = onActivityChange ?? null;

    const available = await activityRecognition.isAvailable();

    if (available) {
      this.useNative = true;
      await this.startNative();
      console.log('[MotionDetector] Started (native)');
    } else {
      this.useNative = false;
      this.startAccelerometer();
      console.log('[MotionDetector] Started (accelerometer fallback)');
    }
  }

  stop(): void {
    if (this.useNative) {
      activityRecognition.stop();
    } else {
      this.accelSubscription?.remove();
      this.accelSubscription = null;
    }
    this.accelBuffer = [];
    this.consecutiveMotion = 0;
    this.consecutiveStationary = 0;
  }

  getIsMoving(): boolean {
    return this.currentIsMoving;
  }

  getAccelVariance(): number {
    if (this.accelBuffer.length < ACCEL_BUFFER_SIZE) return 0;
    return this.computeVariance(this.accelBuffer);
  }

  getLastActivity(): { activity: ActivityType; confidence: number } {
    return {
      activity: this.lastNativeActivity,
      confidence: this.lastNativeConfidence,
    };
  }

  isUsingNative(): boolean {
    return this.useNative;
  }

  async queryHistory(
    startMs: number,
    endMs: number,
  ): Promise<NativeActivityEvent[]> {
    if (!this.useNative) return [];
    return activityRecognition.queryHistory(startMs, endMs);
  }

  // ── Hysteresis event window (used by powerManager) ──

  record(isMoving: boolean): void {
    this.events.push({ isMoving, timestamp: Date.now() });
    if (this.events.length > WINDOW_SIZE) {
      this.events.shift();
    }
  }

  isMotionConfirmed(): boolean {
    const now = Date.now();
    const recent = this.events.filter(e => now - e.timestamp < EVENT_TTL);
    if (recent.length < CONFIRMATION_COUNT) return false;
    return recent.slice(-CONFIRMATION_COUNT).every(e => e.isMoving);
  }

  isStationaryConfirmed(): boolean {
    const now = Date.now();
    const recent = this.events.filter(e => now - e.timestamp < EVENT_TTL);
    if (recent.length < CONFIRMATION_COUNT) return true;
    return recent.slice(-CONFIRMATION_COUNT).every(e => !e.isMoving);
  }

  reset(): void {
    this.events = [];
    this.accelBuffer = [];
    this.consecutiveMotion = 0;
    this.consecutiveStationary = 0;
    this.currentIsMoving = false;
    this.lastNativeActivity = 'unknown';
    this.lastNativeConfidence = 0;
  }

  // ── Tier 1: Native Activity Recognition ──

  private async startNative(): Promise<void> {
    await activityRecognition.start((event: NativeActivityEvent) => {
      const activity = NATIVE_TO_ACTIVITY[event.activity] || 'unknown';
      const confidence = event.confidence;

      this.lastNativeActivity = activity;
      this.lastNativeConfidence = confidence;

      const isMoving = activity !== 'stationary' && activity !== 'unknown';
      const wasMoving = this.currentIsMoving;

      if (isMoving !== wasMoving) {
        this.currentIsMoving = isMoving;
        this.record(isMoving);
        this.motionChangeCallback?.(isMoving);
      }

      this.activityChangeCallback?.(activity, confidence);
    }, 3000);
  }

  // ── Tier 2: Accelerometer Fallback ──

  private startAccelerometer(): void {
    Accelerometer.setUpdateInterval(100); // 10Hz
    this.accelSubscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      this.accelBuffer.push(magnitude);
      if (this.accelBuffer.length > ACCEL_BUFFER_SIZE) {
        this.accelBuffer.shift();
      }

      const now = Date.now();
      if (
        this.accelBuffer.length >= ACCEL_BUFFER_SIZE &&
        now - this.lastEvalTime >= EVAL_INTERVAL
      ) {
        this.lastEvalTime = now;
        this.evaluateAccelMotion();
      }
    });
  }

  private evaluateAccelMotion(): void {
    const variance = this.computeVariance(this.accelBuffer);

    if (variance > MOTION_VARIANCE_THRESHOLD) {
      this.consecutiveMotion++;
      this.consecutiveStationary = 0;
    } else if (variance < STATIONARY_VARIANCE_THRESHOLD) {
      this.consecutiveStationary++;
      this.consecutiveMotion = 0;
    }

    if (!this.currentIsMoving && this.consecutiveMotion >= HYSTERESIS_COUNT) {
      this.currentIsMoving = true;
      this.record(true);
      this.motionChangeCallback?.(true);
    } else if (this.currentIsMoving && this.consecutiveStationary >= HYSTERESIS_COUNT) {
      this.currentIsMoving = false;
      this.record(false);
      this.motionChangeCallback?.(false);
    }
  }

  private computeVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  }
}

export const motionDetector = new MotionDetector();
