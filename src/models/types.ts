export interface GpsPoint {
  id: string;
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  speed: number;
  heading: number;
  timestamp: number;
  batteryLevel?: number;
  isMoving: boolean;
  activity: ActivityType;
  confidence: number;
}

export type ActivityType =
  | 'stationary'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'driving'
  | 'bus'
  | 'train'
  | 'airplane'
  | 'unknown';

export interface Segment {
  id: string;
  type: 'trip' | 'visit';
  startTime: number;
  endTime: number;
  activity: ActivityType;
  points: GpsPoint[];
  simplifiedPoints?: { latitude: number; longitude: number }[];
  distance?: number;
  place?: Place;
}

export interface Place {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radius: number;
  category?: PlaceCategory;
  visitCount: number;
  totalDuration: number;
  firstVisit: number;
  lastVisit: number;
  isGeofenced?: boolean;
}

export type PlaceCategory =
  | 'home'
  | 'work'
  | 'food'
  | 'shopping'
  | 'transit'
  | 'fitness'
  | 'entertainment'
  | 'other';

export interface DayLog {
  date: string;
  segments: Segment[];
  totalDistance: number;
  totalMovingTime: number;
  totalStationaryTime: number;
  placesVisited: number;
  activityBreakdown: Record<ActivityType, number>;
}

export type PowerProfile =
  | 'sleep'
  | 'geofence_only'
  | 'low_power'
  | 'balanced'
  | 'high_accuracy';

export interface PowerContext {
  batteryLevel: number;
  isCharging: boolean;
  isMoving: boolean;
  minutesStationary: number;
  currentActivity: ActivityType;
  activityConfidence: number;
  atKnownPlace: boolean;
  knownPlaceCategory: PlaceCategory | null;
  isNightMode: boolean;
  isPowerSaveMode: boolean;
}

export interface PowerProfileConfig {
  desiredAccuracy: number;
  distanceFilter: number;
  stopTimeout: number;
  heartbeatInterval: number;
  stationaryRadius: number;
  elasticityMultiplier: number;
  preventSuspend: boolean;
}

export interface TrackingState {
  isTracking: boolean;
  currentPosition: GpsPoint | null;
  currentSegment: Segment | null;
  todayLog: DayLog | null;
  selectedDate: string;
  batteryLevel: number;
  currentPowerProfile: PowerProfile;
  isCharging: boolean;
}

export interface AppSettings {
  trackingEnabled: boolean;
  highAccuracyMode: boolean;
  dwellThreshold: number;
  simplifyTolerance: number;
  movingInterval: number;
  stationaryInterval: number;
  mapStyle: 'standard' | 'satellite' | 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  trackingEnabled: true,
  highAccuracyMode: false,
  dwellThreshold: 300,
  simplifyTolerance: 10,
  movingInterval: 10,
  stationaryInterval: 300,
  mapStyle: 'dark',
};
