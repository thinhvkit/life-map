import {
  Platform,
  PermissionsAndroid,
  AppState,
  Alert,
  Linking,
} from 'react-native';
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
import { useGroupStore } from '../store/groupStore';
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
import { gpsFilter } from './gpsFilter';
import { database } from './database';
import { matchToRoads } from './mapMatching';
import { format } from 'date-fns';

class TrackingService {
  private isConfigured = false;
  private currentPoints: GpsPoint[] = [];
  private segmentStartTime: number = Date.now();
  private isMoving: boolean = false;
  private pendingPointIndex: number = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private batteryLevel = 1;
  private isCharging = false;
  private batteryLevelSub: Battery.Subscription | null = null;
  private batteryStateSub: Battery.Subscription | null = null;
  private appStateSub: ReturnType<typeof AppState.addEventListener> | null =
    null;
  private pendingConfig: ExpoLocationConfig | null = null;
  private lastLivePoint: { latitude: number; longitude: number } | null = null;
  private lastPublishedPoint: { latitude: number; longitude: number } | null =
    null;
  private lastPublishAt = 0;
  private simActivity: ActivityType | null = null;
  private lowSpeedSince: number | null = null;
  private highSpeedSince: number | null = null;
  private static readonly SPEED_STATIONARY_THRESHOLD = 0.5; // m/s
  private static readonly SPEED_MOVING_THRESHOLD = 1.5; // m/s
  private static readonly STOP_CONFIRM_MS = 90_000; // 90s of low speed to confirm stop
  private static readonly MOVE_CONFIRM_MS = 15_000; // 15s of high speed to confirm move
  // Throttle Firestore live-point writes (quota/perf). The local trail still
  // renders every >5m; we only push to the cloud every Ns AND every Mm.
  private static readonly LIVE_PUBLISH_INTERVAL_MS = 8_000;
  private static readonly LIVE_PUBLISH_DISTANCE_M = 20;

  async configure(_settings: AppSettings = DEFAULT_SETTINGS): Promise<void> {
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

    registerLocationHandler(locations => {
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

    // Re-arm the battery listeners + pull a fresh reading whenever the app
    // returns to the foreground (iOS suspends JS in the background, so the
    // listeners can go stale/dead while away).
    this.appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        this.setupBatteryMonitoring();
      }
    });

    await motionDetector.start(
      moving => this.onMotionChange(moving),
      (activity, confidence) =>
        this.onNativeActivityChange(activity, confidence),
    );

    powerManager.registerConfigChangeCallback(async config => {
      await this.restartLocationUpdates(config);
    });

    AppState.addEventListener('change', state => {
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

    this.recoverPendingSegment();
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
    gpsFilter.reset();

    // Keep the battery listeners alive for the whole app session — they're set
    // up once in configure() and aren't re-armed by start(), so tearing them
    // down here would freeze the battery reading after the first Stop.

    try {
      database.clearPending();
    } catch {}

    useTrackingStore.getState().clearLivePoints();
    useTrackingStore.getState().setTracking(false);
    // Stopped tracking entirely: leave a "last-seen" point for the group.
    useGroupStore.getState().markStationary();
  }

  async getCurrentPosition(): Promise<GpsPoint> {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 30_000,
      requiredAccuracy: 100,
    });
    if (last) return this.locationToGpsPoint(last);

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.LocationAccuracy.Balanced,
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
      console.log(
        `[Tracking] Restarted with accuracy=${config.accuracy}, dist=${config.distanceInterval}m`,
      );
    } catch {
      this.pendingConfig = config;
    }
  }

  private setupBatteryMonitoring(): void {
    // Idempotent: drop any existing listeners first so this can be re-run on
    // app foreground to re-arm the subscriptions and refresh a fresh reading.
    this.batteryLevelSub?.remove();
    this.batteryStateSub?.remove();

    Battery.getBatteryLevelAsync().then(level => {
      this.batteryLevel = level;
      powerManager.onBatteryUpdate(this.batteryLevel, this.isCharging);
    });
    Battery.getBatteryStateAsync().then(state => {
      this.isCharging =
        state === Battery.BatteryState.CHARGING ||
        state === Battery.BatteryState.FULL;
    });

    this.batteryLevelSub = Battery.addBatteryLevelListener(
      ({ batteryLevel }) => {
        this.batteryLevel = batteryLevel;
        powerManager.onBatteryUpdate(this.batteryLevel, this.isCharging);
      },
    );

    this.batteryStateSub = Battery.addBatteryStateListener(
      ({ batteryState }) => {
        this.isCharging =
          batteryState === Battery.BatteryState.CHARGING ||
          batteryState === Battery.BatteryState.FULL;
        powerManager.onBatteryUpdate(this.batteryLevel, this.isCharging);
      },
    );
  }

  private onLocation(location: Location.LocationObject): void {
    const point = this.locationToGpsPoint(location);

    if (this.simActivity) {
      point.activity = this.simActivity;
      point.confidence = 100;
    } else {
      const gpsSpeed = location.coords.speed ?? 0;

      if (motionDetector.isUsingNative()) {
        const { activity, confidence } = motionDetector.getLastActivity();
        if (activity !== 'unknown' && confidence >= 50) {
          point.activity = activity;
          point.confidence = confidence;
          // Speed sanity check: override if native and GPS speed disagree significantly
          if (activity === 'walking' && gpsSpeed > 8) {
            point.activity = classifyBySpeed(gpsSpeed);
          } else if (activity === 'stationary' && gpsSpeed > 2) {
            point.activity = classifyBySpeed(gpsSpeed);
          }
        } else {
          // Native unknown or low confidence — fall back to speed-based
          point.activity = classifyBySpeed(gpsSpeed);
          point.confidence = 40;
        }
      } else {
        const accelVariance = motionDetector.getAccelVariance();
        const { activity, confidence } = classifyFromSensors(
          gpsSpeed,
          accelVariance,
        );
        point.activity = activity;
        point.confidence = confidence;
      }
      powerManager.onActivityChange(point.activity, point.confidence);
    }

    gpsFilter.setActivity(point.activity);
    const result = gpsFilter.process({
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
      timestamp: point.timestamp,
    });

    if (!result.accepted) {
      if (__DEV__) {
        console.log(
          `[GPS] rejected: ${result.reason} acc=${point.accuracy.toFixed(0)}m`,
        );
      }
      // Still update position for UI even if rejected, but don't record
      if (gpsFilter.getConsecutiveRejections() < 5) {
        return;
      }
      // Too many rejections — accept raw to avoid data gaps
      if (__DEV__) {
        console.log(
          '[GPS] fallback: accepting raw after 5 consecutive rejections',
        );
      }
    }

    if (result.accepted) {
      point.latitude = result.latitude;
      point.longitude = result.longitude;
    }

    if (__DEV__) {
      console.log(
        `[Location] ${point.latitude.toFixed(5)},${point.longitude.toFixed(
          5,
        )} spd=${point.speed.toFixed(1)} acc=${point.accuracy.toFixed(0)}m`,
      );
    }

    useTrackingStore.getState().updatePosition(point);
    useTrackingStore.getState().updateCurrentActivity(point.activity);
    this.currentPoints.push(point);
    this.persistPoint(point);

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

        // Push to Firestore at a throttled cadence to save quota/battery:
        // at most once per LIVE_PUBLISH_INTERVAL_MS and only after moving
        // LIVE_PUBLISH_DISTANCE_M. The local trail above stays fine-grained.
        const lp = this.lastPublishedPoint;
        const farEnough =
          !lp ||
          haversineDistance(
            lp.latitude,
            lp.longitude,
            point.latitude,
            point.longitude,
          ) >= TrackingService.LIVE_PUBLISH_DISTANCE_M;
        if (
          farEnough &&
          point.timestamp - this.lastPublishAt >=
            TrackingService.LIVE_PUBLISH_INTERVAL_MS
        ) {
          useGroupStore.getState().publishPosition(point);
          this.lastPublishAt = point.timestamp;
          this.lastPublishedPoint = live;
        }
      }
    }

    // Speed-based motion detection fallback (time-window confirmed)
    // Catches stops that native activity recognition misses in background
    const now = point.timestamp;
    const speed = point.speed;

    if (this.isMoving) {
      if (speed < TrackingService.SPEED_STATIONARY_THRESHOLD) {
        if (this.lowSpeedSince === null) this.lowSpeedSince = now;
        this.highSpeedSince = null;
        if (now - this.lowSpeedSince >= TrackingService.STOP_CONFIRM_MS) {
          if (__DEV__)
            console.log(
              `[Tracking] speed-based stop confirmed (${(
                (now - this.lowSpeedSince) /
                1000
              ).toFixed(0)}s low-speed)`,
            );
          this.lowSpeedSince = null;
          this.onMotionChange(false);
        }
      } else {
        this.lowSpeedSince = null;
      }
    } else {
      if (speed > TrackingService.SPEED_MOVING_THRESHOLD) {
        if (this.highSpeedSince === null) this.highSpeedSince = now;
        this.lowSpeedSince = null;
        if (now - this.highSpeedSince >= TrackingService.MOVE_CONFIRM_MS) {
          if (__DEV__)
            console.log(
              `[Tracking] speed-based move confirmed (${(
                (now - this.highSpeedSince) /
                1000
              ).toFixed(0)}s high-speed)`,
            );
          this.highSpeedSince = null;
          this.onMotionChange(true);
        }
      } else if (this.currentPoints.length >= 3) {
        this.highSpeedSince = null;
        // Displacement check: if we've drifted >150m from segment start, we're moving
        const first = this.currentPoints[0];
        const displacement = haversineDistance(
          first.latitude,
          first.longitude,
          point.latitude,
          point.longitude,
        );
        if (displacement > 150) {
          if (__DEV__)
            console.log(
              `[Tracking] displacement-based move detected (${displacement.toFixed(
                0,
              )}m from start)`,
            );
          this.lowSpeedSince = null;
          this.onMotionChange(true);
        }
      } else {
        this.highSpeedSince = null;
      }
    }
  }

  private onNativeActivityChange(
    activity: ActivityType,
    confidence: number,
  ): void {
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
      if (!isMoving) {
        // Stationary: stop our trail; leave a "last-seen" point (2-min window).
        useGroupStore.getState().markStationary();
      }
    } else {
      this.isMoving = isMoving;
    }
  }

  private startNewSegment(): void {
    this.currentPoints = [];
    this.pendingPointIndex = 0;
    this.segmentStartTime = Date.now();
    this.lastLivePoint = null;
    this.lastPublishedPoint = null;
    this.lastPublishAt = 0;
    this.lowSpeedSince = null;
    this.highSpeedSince = null;
    useTrackingStore.getState().clearLivePoints();

    try {
      database.savePendingSegment(
        this.segmentStartTime,
        this.isMoving,
        format(new Date(), 'yyyy-MM-dd'),
      );
    } catch (e) {
      console.warn('[Tracking] Failed to persist pending segment:', e);
    }
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
        `[Finalize] type=${segmentType} points=${
          this.currentPoints.length
        } dur=${Math.round((now - this.segmentStartTime) / 1000)}s`,
      );
    }

    const points = [...this.currentPoints];

    const segment: Segment = {
      id: generateId(),
      type: segmentType,
      startTime: this.segmentStartTime,
      endTime: now,
      activity: this.getDominantActivity(),
      points,
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
      } else if (now - this.segmentStartTime >= 120_000) {
        const centroid =
          this.currentPoints[Math.floor(this.currentPoints.length / 2)];
        segment.place = {
          id: generateId(),
          name: 'Unknown Location',
          latitude: centroid.latitude,
          longitude: centroid.longitude,
          radius: 50,
          category: 'other',
          visitCount: 1,
          totalDuration: now - this.segmentStartTime,
          firstVisit: this.segmentStartTime,
          lastVisit: now,
        };
      }
    }

    if (segmentType === 'trip') {
      segment.distance = this.calculateSegmentDistance();

      try {
        const matched = await matchToRoads(points, segment.activity);
        if (matched && matched.confidence > 0.1) {
          segment.simplifiedPoints = matched.coordinates;
          segment.distance = matched.distance;
          console.log(
            `[Finalize] map-matched: ${
              matched.coordinates.length
            } road pts, conf=${matched.confidence.toFixed(2)}`,
          );
        } else {
          console.log(
            `[Finalize] map matching skipped: ${
              matched ? `low conf=${matched.confidence.toFixed(2)}` : 'no match'
            } — falling back to raw`,
          );
        }
      } catch (e) {
        console.warn('[Finalize] map matching failed, using raw:', e);
      }
    }

    useTrackingStore.getState().addSegment(segment);

    try {
      database.clearPending();
    } catch (e) {
      console.warn('[Tracking] Failed to clear pending data:', e);
    }
  }

  async rematchTrips(
    dateKey: string,
  ): Promise<{ ok: number; failed: number; skipped: number }> {
    const segments = await database.getSegmentsByDate(dateKey);
    const trips = segments.filter(
      s => s.type === 'trip' && s.points.length >= 2,
    );
    console.log(`[Rematch] starting for ${dateKey}: ${trips.length} trips`);

    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (const trip of trips) {
      try {
        const matched = await matchToRoads(trip.points, trip.activity);
        if (matched && matched.confidence > 0.1) {
          trip.simplifiedPoints = matched.coordinates;
          trip.distance = matched.distance;
          await database.insertSegment(trip, dateKey);
          ok++;
          console.log(
            `[Rematch] trip ${trip.id} ok conf=${matched.confidence.toFixed(
              2,
            )}`,
          );
        } else {
          skipped++;
          console.log(
            `[Rematch] trip ${trip.id} skipped: ${
              matched ? `conf=${matched.confidence.toFixed(2)}` : 'no match'
            }`,
          );
        }
      } catch (e) {
        failed++;
        console.warn(`[Rematch] trip ${trip.id} error:`, e);
      }
    }

    console.log(`[Rematch] done: ok=${ok} failed=${failed} skipped=${skipped}`);
    await useTrackingStore.getState().loadDayLog(dateKey);
    return { ok, failed, skipped };
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
      // expo-battery reports a 0–1 fraction; store as a 0–100 percent so the
      // UI (and mock data / default of 100) are all on the same scale.
      // Note: this.batteryLevel stays a fraction for powerManager, which does
      // its own *100 conversion.
      batteryLevel: Math.round(this.batteryLevel * 100),
      isMoving: motionDetector.getIsMoving(),
      activity: 'unknown',
      confidence: 0,
    };
  }

  private getDominantActivity(): ActivityType {
    if (this.currentPoints.length === 0) return 'unknown';
    if (this.currentPoints.length === 1) return this.currentPoints[0].activity;

    // Weight by time duration between consecutive points
    const durations: Record<string, number> = {};
    for (let i = 1; i < this.currentPoints.length; i++) {
      const dt =
        this.currentPoints[i].timestamp - this.currentPoints[i - 1].timestamp;
      const activity = this.currentPoints[i].activity;
      durations[activity] = (durations[activity] || 0) + dt;
    }
    // Add first point's activity with the first interval
    if (this.currentPoints.length >= 2) {
      const dt0 =
        this.currentPoints[1].timestamp - this.currentPoints[0].timestamp;
      const a0 = this.currentPoints[0].activity;
      durations[a0] = (durations[a0] || 0) + dt0;
    }

    // Exclude 'unknown' and 'stationary' from trip segments if there's a real activity
    const candidates = Object.entries(durations)
      .filter(([a]) => a !== 'unknown' && a !== 'stationary')
      .sort(([, a], [, b]) => b - a);

    if (candidates.length > 0) {
      return candidates[0][0] as ActivityType;
    }

    return (Object.entries(durations).sort(([, a], [, b]) => b - a)[0]?.[0] ||
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

  private persistPoint(point: GpsPoint): void {
    try {
      database.appendPendingPoint(point, this.pendingPointIndex++);
    } catch (e) {
      console.warn('[Tracking] Failed to persist point:', e);
    }
  }

  private recoverPendingSegment(): void {
    try {
      const pending = database.loadPendingSegment();
      if (!pending || pending.points.length === 0) return;

      console.log(
        `[Tracking] Recovering pending segment: ${pending.points.length} points, moving=${pending.isMoving}`,
      );

      this.currentPoints = pending.points;
      this.pendingPointIndex = pending.points.length;
      this.segmentStartTime = pending.startTime;
      this.isMoving = pending.isMoving;

      if (this.isMoving) {
        const store = useTrackingStore.getState();
        store.clearLivePoints();
        for (const p of pending.points) {
          store.appendLivePoint({
            latitude: p.latitude,
            longitude: p.longitude,
          });
        }
        const last = pending.points[pending.points.length - 1];
        this.lastLivePoint = {
          latitude: last.latitude,
          longitude: last.longitude,
        };
      }
    } catch (e) {
      console.warn('[Tracking] Failed to recover pending segment:', e);
    }
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
      const speed =
        activity === 'walking' ? 1.4 : activity === 'cycling' ? 4.5 : 8.0;
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

    console.log(
      `[Sim] Started ${points.length} points over ${durationMs}ms (${activity})`,
    );
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
  simulateStay(coord: [number, number], durationMs = 150000): void {
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
      `[Sim] Started stay at ${coord[0]},${coord[1]} for ${Math.round(
        durationMs / 1000,
      )}s`,
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
