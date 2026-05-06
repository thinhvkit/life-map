import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
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

    this.restartHeartbeat();
    console.log(`[Tracking] Restarted with accuracy=${config.accuracy}, dist=${config.distanceInterval}m`);
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

    if (motionDetector.isUsingNative()) {
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
  }

  private onNativeActivityChange(activity: ActivityType, confidence: number): void {
    useTrackingStore.getState().updateCurrentActivity(activity);
    powerManager.onActivityChange(activity, confidence);
  }

  private onMotionChange(isMoving: boolean): void {
    powerManager.onMotionChange(isMoving);

    const wasMoving = this.isMoving;
    this.isMoving = isMoving;

    if (wasMoving !== isMoving) {
      this.finalizeCurrentSegment();
      this.startNewSegment();
    }
  }

  private startNewSegment(): void {
    this.currentPoints = [];
    this.segmentStartTime = Date.now();
  }

  private async finalizeCurrentSegment(): Promise<void> {
    if (this.currentPoints.length === 0) return;

    const now = Date.now();
    const segmentType = this.isMoving ? 'trip' : 'visit';

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
}

export const trackingService = new TrackingService();
