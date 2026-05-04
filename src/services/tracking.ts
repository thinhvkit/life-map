import BackgroundGeolocation, {
  Location,
  MotionChangeEvent,
  MotionActivityEvent,
} from 'react-native-background-geolocation';
import {
  GpsPoint,
  Segment,
  ActivityType,
  AppSettings,
  DEFAULT_SETTINGS,
} from '../models/types';
import { useTrackingStore } from '../store/trackingStore';
import { placeDetectionService } from './placeDetection';
import { classifyActivity } from './activityClassifier';
import { generateId, haversineDistance } from '../utils/geo';
import { powerManager } from './powerManager';
import { placeGeofenceManager } from './placeGeofenceManager';
import { motionDetector } from './motionDetector';

class TrackingService {
  private isConfigured = false;
  private currentPoints: GpsPoint[] = [];
  private segmentStartTime: number = Date.now();
  private isMoving: boolean = false;

  async configure(
    _settings: AppSettings = DEFAULT_SETTINGS,
  ): Promise<void> {
    if (this.isConfigured) return;

    await placeGeofenceManager.init();
    await placeDetectionService.init();

    await BackgroundGeolocation.ready({
      geolocation: {
        desiredAccuracy: 10, // Start balanced
        distanceFilter: 25,
        stopTimeout: 5,
        stationaryRadius: 25,
        locationAuthorizationRequest: 'Always',
      },
      logger: {
        debug: __DEV__,
        logLevel: __DEV__ ? 5 : 0, // Verbose : Off
      },
      app: {
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
        preventSuspend: false,
        heartbeatInterval: 60,
        backgroundPermissionRationale: {
          title: 'Allow location access in background?',
          message:
            'Life Map needs background location to automatically track your daily movements and visited places.',
          positiveAction: 'Allow',
          negativeAction: 'Cancel',
        },
      },
      activity: {
        activityRecognitionInterval: 10000,
        minimumActivityRecognitionConfidence: 70,
      },
    });

    this.registerEventListeners();
    this.isConfigured = true;
  }

  async start(): Promise<void> {
    if (!this.isConfigured) await this.configure();
    await BackgroundGeolocation.start();
    useTrackingStore.getState().setTracking(true);
  }

  async stop(): Promise<void> {
    await this.finalizeCurrentSegment();
    await BackgroundGeolocation.stop();
    motionDetector.reset();
    useTrackingStore.getState().setTracking(false);
  }

  async getCurrentPosition(): Promise<GpsPoint> {
    const location = await BackgroundGeolocation.getCurrentPosition({
      samples: 3,
      persist: true,
      timeout: 30,
      maximumAge: 5000,
      desiredAccuracy: 10,
    });
    return this.locationToGpsPoint(location);
  }

  private registerEventListeners(): void {
    BackgroundGeolocation.onLocation(
      location => this.onLocation(location),
      error => console.warn('[Tracking] Location error:', error),
    );

    BackgroundGeolocation.onMotionChange(event =>
      this.onMotionChange(event),
    );

    BackgroundGeolocation.onActivityChange(event =>
      this.onActivityChange(event),
    );

    BackgroundGeolocation.onProviderChange(event => {
      console.log('[Tracking] Provider change:', event);
    });

    BackgroundGeolocation.onHeartbeat(() => {
      powerManager.onHeartbeat();
    });

    BackgroundGeolocation.onGeofence(event => {
      placeGeofenceManager.handleGeofenceEvent(event);
    });

    BackgroundGeolocation.onPowerSaveChange(enabled => {
      powerManager.onPowerSaveChange(enabled);
    });

    placeGeofenceManager.onGeofenceEnter((placeId: string) => {
      const place = placeDetectionService.getPlace(placeId);
      powerManager.onGeofenceEnter(place?.category ?? null);
    });

    placeGeofenceManager.onGeofenceExit(() => {
      powerManager.onGeofenceExit();
    });
  }

  private onLocation(location: Location): void {
    const point = this.locationToGpsPoint(location);
    useTrackingStore.getState().updatePosition(point);
    this.currentPoints.push(point);

    if (location.battery) {
      powerManager.onLocation({
        level: location.battery.level,
        is_charging: location.battery.is_charging,
      });
    }
  }

  private onMotionChange(event: MotionChangeEvent): void {
    powerManager.onMotionChange(event.isMoving);

    const wasMoving = this.isMoving;
    this.isMoving = event.isMoving;

    if (wasMoving !== event.isMoving) {
      this.finalizeCurrentSegment();
      this.startNewSegment(event.isMoving);
    }
  }

  private onActivityChange(event: MotionActivityEvent): void {
    const activity = classifyActivity(event.activity, event.confidence);
    useTrackingStore.getState().updateCurrentActivity(activity);
    powerManager.onActivityChange(activity, event.confidence);
  }

  private startNewSegment(_isMoving: boolean): void {
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

  private locationToGpsPoint(location: Location): GpsPoint {
    return {
      id: generateId(),
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      altitude: location.coords.altitude || 0,
      accuracy: location.coords.accuracy,
      speed: location.coords.speed || 0,
      heading: location.coords.heading || 0,
      timestamp: new Date(location.timestamp).getTime(),
      batteryLevel: location.battery?.level,
      isMoving: location.is_moving,
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
}

export const trackingService = new TrackingService();
