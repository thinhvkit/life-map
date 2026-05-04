import BackgroundGeolocation from 'react-native-background-geolocation';
import {
  PowerProfile,
  PowerContext,
  PowerProfileConfig,
  ActivityType,
  PlaceCategory,
} from '../models/types';
import { useTrackingStore } from '../store/trackingStore';
import { motionDetector } from './motionDetector';

const PROFILE_CONFIGS: Record<PowerProfile, PowerProfileConfig> = {
  sleep: {
    desiredAccuracy: 3000,  // Lowest
    distanceFilter: 500,
    stopTimeout: 1,
    heartbeatInterval: 900, // 15 min
    stationaryRadius: 200,
    elasticityMultiplier: 0,
    preventSuspend: false,
  },
  geofence_only: {
    desiredAccuracy: 1000, // VeryLow
    distanceFilter: 200,
    stopTimeout: 1,
    heartbeatInterval: 300, // 5 min
    stationaryRadius: 100,
    elasticityMultiplier: 0,
    preventSuspend: false,
  },
  low_power: {
    desiredAccuracy: 100,  // Low
    distanceFilter: 100,
    stopTimeout: 3,
    heartbeatInterval: 120, // 2 min
    stationaryRadius: 50,
    elasticityMultiplier: 1,
    preventSuspend: false,
  },
  balanced: {
    desiredAccuracy: 10,   // Medium
    distanceFilter: 25,
    stopTimeout: 5,
    heartbeatInterval: 60,
    stationaryRadius: 25,
    elasticityMultiplier: 2,
    preventSuspend: false,
  },
  high_accuracy: {
    desiredAccuracy: -1,   // High
    distanceFilter: 10,
    stopTimeout: 5,
    heartbeatInterval: 60,
    stationaryRadius: 25,
    elasticityMultiplier: 3,
    preventSuspend: true,
  },
};

// Activity-specific distanceFilter overrides (applied on top of profile)
const ACTIVITY_DISTANCE_FILTERS: Partial<Record<ActivityType, number>> = {
  walking: 8,
  running: 15,
  cycling: 25,
  driving: 50,
  bus: 100,
  train: 200,
};

const MIN_CONFIG_INTERVAL = 10000; // Don't change config more than once per 10s

class PowerManager {
  private currentProfile: PowerProfile = 'balanced';
  private lastConfigTime = 0;
  private pendingProfile: PowerProfile | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  // Context state
  private isMoving = false;
  private stationarySince = Date.now();
  private currentActivity: ActivityType = 'unknown';
  private activityConfidence = 0;
  private atKnownPlace = false;
  private knownPlaceCategory: PlaceCategory | null = null;
  private isPowerSaveMode = false;
  private batteryLevel = 100;
  private isCharging = false;
  private useGeofenceMode = false;

  getProfile(): PowerProfile {
    return this.currentProfile;
  }

  onMotionChange(isMoving: boolean): void {
    motionDetector.record(isMoving);

    if (isMoving && !motionDetector.isMotionConfirmed()) {
      return; // Wait for confirmed motion before upgrading
    }

    this.isMoving = isMoving;
    if (!isMoving) {
      this.stationarySince = Date.now();
    }

    this.evaluate();
  }

  onActivityChange(activity: ActivityType, confidence: number): void {
    this.currentActivity = activity;
    this.activityConfidence = confidence;

    if (this.isMoving && this.currentProfile !== 'sleep') {
      this.applyActivityDistanceFilter(activity);
    }
  }

  onLocation(battery: { level: number; is_charging: boolean }): void {
    this.batteryLevel = Math.round(battery.level * 100);
    this.isCharging = battery.is_charging;

    const store = useTrackingStore.getState();
    store.setCharging(this.isCharging);

    this.evaluate();
  }

  onHeartbeat(): void {
    // Heartbeat fires during sleep/geofence_only modes
    // Re-evaluate in case conditions changed (e.g., morning wake-up)
    this.evaluate();
  }

  onGeofenceEnter(category: PlaceCategory | null): void {
    this.atKnownPlace = true;
    this.knownPlaceCategory = category;
    this.evaluate();
  }

  onGeofenceExit(): void {
    this.atKnownPlace = false;
    this.knownPlaceCategory = null;

    // Force transition out of geofence_only mode
    if (this.useGeofenceMode) {
      this.switchToLocationMode();
    }

    this.evaluate();
  }

  onPowerSaveChange(enabled: boolean): void {
    this.isPowerSaveMode = enabled;
    this.evaluate();
  }

  private evaluate(): void {
    const context = this.buildContext();
    const newProfile = this.selectProfile(context);

    if (newProfile !== this.currentProfile) {
      this.scheduleTransition(newProfile);
    }
  }

  private buildContext(): PowerContext {
    const now = Date.now();
    const minutesStationary = this.isMoving
      ? 0
      : (now - this.stationarySince) / 60000;

    const hour = new Date().getHours();
    const isNightMode = hour >= 23 || hour < 6;

    return {
      batteryLevel: this.batteryLevel,
      isCharging: this.isCharging,
      isMoving: this.isMoving,
      minutesStationary,
      currentActivity: this.currentActivity,
      activityConfidence: this.activityConfidence,
      atKnownPlace: this.atKnownPlace,
      knownPlaceCategory: this.knownPlaceCategory,
      isNightMode,
      isPowerSaveMode: this.isPowerSaveMode,
    };
  }

  private selectProfile(ctx: PowerContext): PowerProfile {
    // Charging bypasses battery constraints
    if (ctx.isCharging && ctx.isMoving) return 'high_accuracy';
    if (ctx.isCharging && !ctx.isMoving) return 'balanced';

    // OS power save mode — force low power
    if (ctx.isPowerSaveMode) return 'low_power';

    // Night + long stationary = sleep
    if (ctx.isNightMode && ctx.minutesStationary > 30) return 'sleep';

    // At known place (home/work) and stationary
    if (ctx.atKnownPlace && !ctx.isMoving) return 'geofence_only';

    // Battery critical
    if (ctx.batteryLevel < 15) return 'low_power';

    // Stationary but not at known place (might be at a café, etc.)
    if (!ctx.isMoving && ctx.minutesStationary > 5) return 'low_power';

    // Battery low, moving
    if (ctx.batteryLevel < 30) return 'balanced';

    // Moving with good battery — use high accuracy for walking/running
    if (
      ctx.currentActivity === 'walking' ||
      ctx.currentActivity === 'running'
    ) {
      return 'high_accuracy';
    }

    // Default moving mode
    return 'balanced';
  }

  private scheduleTransition(profile: PowerProfile): void {
    const now = Date.now();
    const elapsed = now - this.lastConfigTime;

    if (elapsed >= MIN_CONFIG_INTERVAL) {
      this.applyProfile(profile);
      return;
    }

    // Debounce: schedule for later
    this.pendingProfile = profile;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      if (this.pendingProfile) {
        this.applyProfile(this.pendingProfile);
        this.pendingProfile = null;
      }
    }, MIN_CONFIG_INTERVAL - elapsed);
  }

  private async applyProfile(profile: PowerProfile): Promise<void> {
    const config = PROFILE_CONFIGS[profile];
    const prev = this.currentProfile;
    this.currentProfile = profile;
    this.lastConfigTime = Date.now();

    console.log(`[Power] ${prev} → ${profile}`);

    useTrackingStore.getState().setPowerProfile(profile);

    // Switch between geofence-only mode and full location tracking
    if (profile === 'geofence_only' && !this.useGeofenceMode) {
      await this.switchToGeofenceMode(config);
      return;
    }
    if (profile !== 'geofence_only' && this.useGeofenceMode) {
      await this.switchToLocationMode();
    }

    try {
      await BackgroundGeolocation.setConfig({
        geolocation: {
          desiredAccuracy: config.desiredAccuracy as any,
          distanceFilter: config.distanceFilter,
          stopTimeout: config.stopTimeout,
          stationaryRadius: config.stationaryRadius,
          disableElasticity: config.elasticityMultiplier === 0,
          elasticityMultiplier: config.elasticityMultiplier,
        },
        app: {
          heartbeatInterval: config.heartbeatInterval,
          preventSuspend: config.preventSuspend,
        },
      });
    } catch (err) {
      console.warn('[Power] setConfig failed:', err);
    }
  }

  private async switchToGeofenceMode(
    config: PowerProfileConfig,
  ): Promise<void> {
    try {
      await BackgroundGeolocation.stop();
      await BackgroundGeolocation.setConfig({
        geolocation: {
          desiredAccuracy: config.desiredAccuracy as any,
          distanceFilter: config.distanceFilter,
          stationaryRadius: config.stationaryRadius,
        },
        app: {
          heartbeatInterval: config.heartbeatInterval,
          preventSuspend: false,
        },
      });
      await BackgroundGeolocation.startGeofences();
      this.useGeofenceMode = true;
      console.log('[Power] Switched to geofence-only mode');
    } catch (err) {
      console.warn('[Power] Failed to switch to geofence mode:', err);
    }
  }

  private async switchToLocationMode(): Promise<void> {
    try {
      await BackgroundGeolocation.stop();
      await BackgroundGeolocation.start();
      this.useGeofenceMode = false;
      console.log('[Power] Switched to location tracking mode');
    } catch (err) {
      console.warn('[Power] Failed to switch to location mode:', err);
    }
  }

  private async applyActivityDistanceFilter(
    activity: ActivityType,
  ): Promise<void> {
    const override = ACTIVITY_DISTANCE_FILTERS[activity];
    if (!override) return;

    const baseFilter =
      PROFILE_CONFIGS[this.currentProfile].distanceFilter;
    const filter = Math.max(override, baseFilter);

    try {
      await BackgroundGeolocation.setConfig({
        geolocation: { distanceFilter: filter },
      });
    } catch {}
  }
}

export const powerManager = new PowerManager();
