import { Platform, PermissionsAndroid, AppState, Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import {
  GpsPoint,
  Segment,
  ActivityType,
  AppSettings,
  DEFAULT_SETTINGS,
} from '../models/types';
import { useTrackingStore } from '../store/trackingStore';
import { placeDetectionService } from './placeDetection';
import { classifyFromSensors, classifyBySpeed } from './activityClassifier';
import { generateId, haversineDistance } from '../utils/geo';
import { powerManager, ExpoLocationConfig } from './powerManager';
import { placeGeofenceManager } from './placeGeofenceManager';
import { motionDetector } from './motionDetector';
import {
  BACKGROUND_LOCATION_TASK,
  registerLocationHandler,
  registerGeofenceHandler,
} from './backgroundTasks';

class TrackingService {
  private isConfigured = false;
  private currentPoints: GpsPoint[] = [];
  private segmentStartTime: number = Date.now();
  private isMoving: boolean = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private batteryLevel = 1;
  private isCharging = false;
  private batteryLevelSub: Battery.Subscription | null = null;
  private batteryStateSub: Battery.Subscription | null = null;
  private pendingConfig: ExpoLocationConfig | null = null;
  private lastLivePoint: { latitude: number; longitude: number } | null = null;
  private simActivity: ActivityType | null = null;

  async configure(
    _settings: AppSettings = DEFAULT_SETTINGS,
  ): Promise<void> {
    if (this.isConfigured) return;

    await placeGeofenceManager.init();
    await placeDetectionService.init();

    const { status: fgStatus } =
      await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      throw { code: 0, message: 'Foreground location permission denied' };
    }

    const { status: bgStatus } =
      await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      Alert.alert(
        'Background Location Required',
        'Please enable "Always" location access for Life Map in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      throw { code: 0, message: 'Background location permission denied' };
    }

    registerLocationHandler((locations) => {
      for (const loc of locations) {
        this.onLocation(loc);
      }
    });

    registerGeofenceHandler((eventType, region) => {
      placeGeofenceManager.handleGeofenceEvent(eventType, region);
    });

    if (Platform.OS === 'android' && Platform.Version >= 29) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      );
    }

    this.setupBatteryMonitoring();

    await motionDetector.start(
      (moving) => this.onMotionChange(moving),
      (activity, confidence) => this.onNativeActivityChange(activity, confidence),
    );

    powerManager.registerConfigChangeCallback(async (config) => {
      await this.restartLocationUpdates(config);
    });

    AppState.addEventListener('change', (state) => {
      if (state === 'active' && this.pendingConfig) {
        this.restartLocationUpdates(this.pendingConfig);
      }
    });

    placeGeofenceManager.onGeofenceEnter((placeId: string) => {
      const place = placeDetectionService.getPlace(placeId);
      powerManager.onGeofenceEnter(place?.category ?? null);
    });

    placeGeofenceManager.onGeofenceExit(() => {
      powerManager.onGeofenceExit();
    });

    this.isConfigured = true;
  }

  async start(): Promise<void> {
    if (!this.isConfigured) await this.configure();

    const config = powerManager.getCurrentLocationConfig();
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: config.accuracy,
      distanceInterval: config.distanceInterval,
      deferredUpdatesInterval: config.deferredUpdatesInterval,
      activityType: Location.ActivityType.OtherNavigation,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Life Map',
        notificationBody: 'Tracking your location',
      },
    });

    this.startHeartbeat();
    useTrackingStore.getState().setTracking(true);
  }

  async stop(): Promise<void> {
    await this.finalizeCurrentSegment();

    const isRunning = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }

    this.stopHeartbeat();
    motionDetector.stop();
    motionDetector.reset();

    this.batteryLevelSub?.remove();
    this.batteryStateSub?.remove();
    this.batteryLevelSub = null;
    this.batteryStateSub = null;

    useTrackingStore.getState().clearLivePoints();
    useTrackingStore.getState().setTracking(false);
  }

  async getCurrentPosition(): Promise<GpsPoint> {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.LocationAccuracy.High,
    });
    return this.locationToGpsPoint(location);
  }

  async restartLocationUpdates(config: ExpoLocationConfig): Promise<void> {
    let isRunning = false;
    try {
      isRunning = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK,
      );
    } catch {
      return;
    }
    if (!isRunning) return;

    try {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: config.accuracy,
        distanceInterval: config.distanceInterval,
        deferredUpdatesInterval: config.deferredUpdatesInterval,
        activityType: Location.ActivityType.OtherNavigation,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'Life Map',
          notificationBody: 'Tracking your location',
        },
      });
      this.pendingConfig = null;
      this.restartHeartbeat();
      console.log(`[Tracking] Restarted with accuracy=${config.accuracy}, dist=${config.distanceInterval}m`);
    } catch {
      this.pendingConfig = config;
    }
  }

  private setupBatteryMonitoring(): void {
    Battery.getBatteryLevelAsync().then(level => {
      this.batteryLevel = level;
    });
    Battery.getBatteryStateAsync().then(state => {
      this.isCharging =
        state === Battery.BatteryState.CHARGING ||
        state === Battery.BatteryState.FULL;
    });

    this.batteryLevelSub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      this.batteryLevel = batteryLevel;
      powerManager.onBatteryUpdate(this.batteryLevel, this.isCharging);
    });

    this.batteryStateSub = Battery.addBatteryStateListener(({ batteryState }) => {
      this.isCharging =
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL;
      powerManager.onBatteryUpdate(this.batteryLevel, this.isCharging);
    });
  }

  private onLocation(location: Location.LocationObject): void {
    const point = this.locationToGpsPoint(location);
    if (__DEV__) {
      console.log(`[Location] ${point.latitude.toFixed(5)},${point.longitude.toFixed(5)} spd=${point.speed.toFixed(1)} acc=${point.accuracy.toFixed(0)}m`);
    }

    if (this.simActivity) {
      point.activity = this.simActivity;
      point.confidence = 100;
    } else if (motionDetector.isUsingNative()) {
      const { activity, confidence } = motionDetector.getLastActivity();
      point.activity = activity;
      point.confidence = confidence;
    } else {
      const speed = location.coords.speed ?? 0;
      const accelVariance = motionDetector.getAccelVariance();
      const { activity, confidence } = classifyFromSensors(speed, accelVariance);
      point.activity = activity;
      point.confidence = confidence;
      powerManager.onActivityChange(activity, confidence);
    }

    useTrackingStore.getState().updatePosition(point);
    useTrackingStore.getState().updateCurrentActivity(point.activity);
    this.currentPoints.push(point);

    if (this.isMoving) {
      const last = this.lastLivePoint;
      const moved =
        !last ||
        haversineDistance(
          last.latitude,
          last.longitude,
          point.latitude,
          point.longitude,
        ) > 5;
      if (moved) {
        const live = { latitude: point.latitude, longitude: point.longitude };
        useTrackingStore.getState().appendLivePoint(live);
        this.lastLivePoint = live;
      }
    }
  }

  private onNativeActivityChange(activity: ActivityType, confidence: number): void {
    useTrackingStore.getState().updateCurrentActivity(activity);
    powerManager.onActivityChange(activity, confidence);
  }

  private onMotionChange(isMoving: boolean): void {
    powerManager.onMotionChange(isMoving);

    const wasMoving = this.isMoving;
    if (wasMoving !== isMoving) {
      // Finalize the segment we're CLOSING (uses old this.isMoving for type)
      this.finalizeCurrentSegment();
      this.isMoving = isMoving;
      this.startNewSegment();
    } else {
      this.isMoving = isMoving;
    }
  }

  private startNewSegment(): void {
    this.currentPoints = [];
    this.segmentStartTime = Date.now();
    this.lastLivePoint = null;
    useTrackingStore.getState().clearLivePoints();
  }

  private async finalizeCurrentSegment(): Promise<void> {
    if (this.currentPoints.length === 0) {
      if (__DEV__) console.log('[Finalize] skipped: no points');
      return;
    }

    const now = Date.now();
    const segmentType = this.isMoving ? 'trip' : 'visit';
    if (__DEV__) {
      console.log(
        `[Finalize] type=${segmentType} points=${this.currentPoints.length} dur=${Math.round((now - this.segmentStartTime) / 1000)}s`,
      );
    }

    const segment: Segment = {
      id: generateId(),
      type: segmentType,
      startTime: this.segmentStartTime,
      endTime: now,
      activity: this.getDominantActivity(),
      points: [...this.currentPoints],
    };

    if (segmentType === 'visit' && this.currentPoints.length > 0) {
      const place = await placeDetectionService.evaluateVisit(
        this.currentPoints,
        this.segmentStartTime,
        now,
      );
      if (place) {
        segment.place = place;
        await placeGeofenceManager.ensureGeofence(place);
      }
    }

    if (segmentType === 'trip') {
      segment.distance = this.calculateSegmentDistance();
    }

    useTrackingStore.getState().addSegment(segment);
  }

  private locationToGpsPoint(location: Location.LocationObject): GpsPoint {
    return {
      id: generateId(),
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude ?? 0,
      accuracy: location.coords.accuracy ?? 0,
      speed: location.coords.speed ?? 0,
      heading: location.coords.heading ?? 0,
      timestamp: location.timestamp,
      batteryLevel: this.batteryLevel,
      isMoving: motionDetector.getIsMoving(),
      activity: 'unknown',
      confidence: 0,
    };
  }

  private getDominantActivity(): ActivityType {
    if (this.currentPoints.length === 0) return 'unknown';

    const counts: Record<string, number> = {};
    for (const p of this.currentPoints) {
      counts[p.activity] = (counts[p.activity] || 0) + 1;
    }

    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      'unknown') as ActivityType;
  }

  private calculateSegmentDistance(): number {
    let total = 0;
    for (let i = 1; i < this.currentPoints.length; i++) {
      total += haversineDistance(
        this.currentPoints[i - 1].latitude,
        this.currentPoints[i - 1].longitude,
        this.currentPoints[i].latitude,
        this.currentPoints[i].longitude,
      );
    }
    return total;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = powerManager.getProfileConfig().heartbeatInterval * 1000;
    this.heartbeatTimer = setInterval(() => {
      powerManager.onHeartbeat();
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private restartHeartbeat(): void {
    this.startHeartbeat();
  }

  // ── Dev: simulate a walking route ──

  private simTimer: ReturnType<typeof setInterval> | null = null;

  simulateRoute(
    waypoints: [number, number][],
    durationMs = 60000,
    activity: ActivityType = 'walking',
  ): void {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }

    const points: [number, number][] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const steps = 10;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        points.push([
          waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * t,
          waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * t,
        ]);
      }
    }
    points.push(waypoints[waypoints.length - 1]);

    const interval = durationMs / points.length;
    let idx = 0;

    // Tag all points emitted during simulation with the requested activity
    this.simActivity = activity;

    // Trigger motion start
    this.onMotionChange(true);

    this.simTimer = setInterval(() => {
      if (idx >= points.length) {
        clearInterval(this.simTimer!);
        this.simTimer = null;
        this.onMotionChange(false);
        this.simActivity = null;
        console.log('[Sim] Route complete');
        return;
      }

      const [lat, lng] = points[idx];
      const speed = activity === 'walking' ? 1.4 : activity === 'cycling' ? 4.5 : 8.0;
      const fakeLocation: Location.LocationObject = {
        coords: {
          latitude: lat,
          longitude: lng,
          altitude: 10,
          accuracy: 8,
          speed,
          heading: 0,
          altitudeAccuracy: 3,
        },
        timestamp: Date.now(),
      };
      this.onLocation(fakeLocation);
      idx++;
    }, interval);

    console.log(`[Sim] Started ${points.length} points over ${durationMs}ms (${activity})`);
  }

  stopSimulation(): void {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
      this.onMotionChange(false);
      this.simActivity = null;
      console.log('[Sim] Stopped');
    }
  }

  // Dev: simulate being stationary at a coordinate for `durationMs`,
  // emitting one point every 5 seconds. After it ends, finalizes the
  // visit by triggering a motion-change still→moving (and back to still).
  simulateStay(
    coord: [number, number],
    durationMs = 150000,
  ): void {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }

    this.simActivity = 'stationary';

    // Make sure we're in 'still' state and a fresh segment starts
    this.onMotionChange(false);
    if (this.currentPoints.length === 0) {
      // startNewSegment was a no-op since we were already still — force timestamp
      this.startNewSegment();
    }

    const tickMs = 5000;
    const totalTicks = Math.max(1, Math.floor(durationMs / tickMs));
    let idx = 0;

    // Emit first point immediately so finalize has data even on short stays
    this.emitFakeStay(coord);

    this.simTimer = setInterval(() => {
      idx++;
      if (idx >= totalTicks) {
        clearInterval(this.simTimer!);
        this.simTimer = null;
        // Finalize the visit by transitioning still → moving
        this.onMotionChange(true);
        // Then back to still so next sim is clean
        this.onMotionChange(false);
        this.simActivity = null;
        console.log('[Sim] Stay complete');
        return;
      }
      this.emitFakeStay(coord);
    }, tickMs);

    console.log(
      `[Sim] Started stay at ${coord[0]},${coord[1]} for ${Math.round(durationMs / 1000)}s`,
    );
  }

  private emitFakeStay(coord: [number, number]): void {
    const [lat, lng] = coord;
    // Tiny GPS jitter so points aren't identical
    const jitter = () => (Math.random() - 0.5) * 0.00002;
    const fakeLocation: Location.LocationObject = {
      coords: {
        latitude: lat + jitter(),
        longitude: lng + jitter(),
        altitude: 10,
        accuracy: 6,
        speed: 0,
        heading: 0,
        altitudeAccuracy: 3,
      },
      timestamp: Date.now(),
    };
    this.onLocation(fakeLocation);
  }
}

export const trackingService = new TrackingService();
