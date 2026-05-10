import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';

export const BACKGROUND_LOCATION_TASK = 'background-location-task';
export const BACKGROUND_GEOFENCING_TASK = 'background-geofencing-task';

let onLocationCallback:
  | ((locations: Location.LocationObject[]) => void)
  | null = null;
let onGeofenceCallback:
  | ((eventType: Location.GeofencingEventType, region: Location.LocationRegion) => void)
  | null = null;

let locationBuffer: Location.LocationObject[] = [];

export function registerLocationHandler(
  cb: (locations: Location.LocationObject[]) => void,
): void {
  onLocationCallback = cb;
  if (locationBuffer.length > 0) {
    console.log(`[BGTask] Flushing ${locationBuffer.length} buffered locations`);
    cb(locationBuffer);
    locationBuffer = [];
  }
}

export function registerGeofenceHandler(
  cb: (eventType: Location.GeofencingEventType, region: Location.LocationRegion) => void,
): void {
  onGeofenceCallback = cb;
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[BGTask] Location error:', error.message);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (onLocationCallback) {
      onLocationCallback(locations);
    } else {
      locationBuffer.push(...locations);
    }
  }
});

TaskManager.defineTask(BACKGROUND_GEOFENCING_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[BGTask] Geofence error:', error.message);
    return;
  }
  if (data) {
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };
    onGeofenceCallback?.(eventType, region);
  }
});
