import * as Location from 'expo-location';
import {
  PowerProfile,
  PowerContext,
  PowerProfileConfig,
  ActivityType,
  PlaceCategory,
} from '../models/types';
import { useTrackingStore } from '../store/trackingStore';
import { motionDetector } from './motionDetector';

export interface ExpoLocationConfig {
  accuracy: Location.LocationAccuracy;
  distanceInterval: number;
  deferredUpdatesInterval: number;
}

const PROFILE_CONFIGS: Record<PowerProfile, PowerProfileConfig> = {
  sleep: {
    desiredAccuracy: 1, // Lowest
    distanceFilter: 1000,
    stopTimeout: 1,
    heartbeatInterval: 1800,
    stationaryRadius: 200,
    elasticityMultiplier: 0,
    preventSuspend: false,
  },
  geofence_only: {
    desiredAccuracy: 2, // Low
    distanceFilter: 200,
    stopTimeout: 1,
    heartbeatInterval: 300,
    stationaryRadius: 100,
    elasticityMultiplier: 0,
    preventSuspend: false,
  },
  low_power: {
    desiredAccuracy: 2, // Low
    distanceFilter: 100,
    stopTimeout: 3,
    heartbeatInterval: 120,
    stationaryRadius: 50,
    elasticityMultiplier: 1,
    preventSuspend: false,
  },
  balanced: {
    desiredAccuracy: 3, // Balanced
    distanceFilter: 25,
    stopTimeout: 5,
    heartbeatInterval: 60,
    stationaryRadius: 25,
    elasticityMultiplier: 2,
    preventSuspend: false,
  },
  high_accuracy: {
    desiredAccuracy: 6, // BestForNavigation
    distanceFilter: 10,
    stopTimeout: 5,
    heartbeatInterval: 60,
    stationaryRadius: 25,
    elasticityMultiplier: 3,
    preventSuspend: true,
  },
};

const ACCURACY_MAP: Record<PowerProfile, Location.LocationAccuracy> = {
  sleep: Location.LocationAccuracy.Lowest,
  geofence_only: Location.LocationAccuracy.Low,
  low_power: Location.LocationAccuracy.Low,
  balanced: Location.LocationAccuracy.Balanced,
  high_accuracy: Location.LocationAccuracy.BestForNavigation,
};

const MIN_CONFIG_INTERVAL = 30000; // 30s — restarting the location task has more overhead

class PowerManager {
  private currentProfile: PowerProfile = 'balanced';
  private lastConfigTime = 0;
  private pendingProfile: PowerProfile | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private configChangeCallback:
    | ((config: ExpoLocationConfig, profile: PowerProfile) => Promise<void>)
    | null = null;

  private isMoving = false;
  private stationarySince = Date.now();
  private currentActivity: ActivityType = 'unknown';
  private activityConfidence = 0;
  private atKnownPlace = false;
  private knownPlaceCategory: PlaceCategory | null = null;
  private isPowerSaveMode = false;
  private batteryLevel = 100;
  private isCharging = false;

  getProfile(): PowerProfile {
    return this.currentProfile;
  }

  getProfileConfig(): PowerProfileConfig {
    return PROFILE_CONFIGS[this.currentProfile];
  }

  getCurrentLocationConfig(): ExpoLocationConfig {
    return this.profileToExpoConfig(this.currentProfile);
  }

  registerConfigChangeCallback(
    cb: (config: ExpoLocationConfig, profile: PowerProfile) => Promise<void>,
  ): void {
    this.configChangeCallback = cb;
  }

  onMotionChange(isMoving: boolean): void {
    motionDetector.record(isMoving);

    if (isMoving && !motionDetector.isMotionConfirmed()) {
      return;
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
  }

  onBatteryUpdate(level: number, charging: boolean): void {
    this.batteryLevel = Math.round(level * 100);
    this.isCharging = charging;

    useTrackingStore.getState().setCharging(this.isCharging);
    this.evaluate();
  }

  onHeartbeat(): void {
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
    if (ctx.isCharging && ctx.isMoving) return 'high_accuracy';
    if (ctx.isCharging && !ctx.isMoving) return 'balanced';
    if (ctx.isPowerSaveMode) return 'low_power';
    if (ctx.isNightMode && ctx.minutesStationary > 15) return 'sleep';
    if (ctx.atKnownPlace && !ctx.isMoving) return 'geofence_only';
    if (ctx.batteryLevel < 20) return 'low_power';
    if (!ctx.isMoving && ctx.minutesStationary > 8) return 'low_power';
    if (ctx.batteryLevel < 30) return 'balanced';
    if (
      ctx.currentActivity === 'walking' ||
      ctx.currentActivity === 'running'
    ) {
      return 'high_accuracy';
    }
    return 'balanced';
  }

  private scheduleTransition(profile: PowerProfile): void {
    const now = Date.now();
    const elapsed = now - this.lastConfigTime;

    if (elapsed >= MIN_CONFIG_INTERVAL) {
      this.applyProfile(profile);
      return;
    }

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
    const prev = this.currentProfile;
    const prevConfig = this.profileToExpoConfig(prev);
    const newConfig = this.profileToExpoConfig(profile);

    this.currentProfile = profile;
    this.lastConfigTime = Date.now();

    console.log(`[Power] ${prev} → ${profile}`);
    useTrackingStore.getState().setPowerProfile(profile);

    if (this.needsRestart(prevConfig, newConfig)) {
      try {
        await this.configChangeCallback?.(newConfig, profile);
      } catch (err) {
        console.warn('[Power] Config change failed:', err);
      }
    }
  }

  private profileToExpoConfig(profile: PowerProfile): ExpoLocationConfig {
    const config = PROFILE_CONFIGS[profile];
    return {
      accuracy: ACCURACY_MAP[profile],
      distanceInterval: config.distanceFilter,
      deferredUpdatesInterval: config.heartbeatInterval * 1000,
    };
  }

  private needsRestart(
    prev: ExpoLocationConfig,
    next: ExpoLocationConfig,
  ): boolean {
    return (
      prev.accuracy !== next.accuracy ||
      prev.distanceInterval !== next.distanceInterval
    );
  }
}

export const powerManager = new PowerManager();
