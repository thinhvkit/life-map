import * as Location from 'expo-location';
import { Place } from '../models/types';
import { database } from './database';
import { BACKGROUND_GEOFENCING_TASK } from './backgroundTasks';

const GEOFENCE_PREFIX = 'known-place:';
const MIN_RADIUS = 200;
const MAX_GEOFENCES = 20; // iOS limit

class PlaceGeofenceManager {
  private geofencedPlaceIds = new Set<string>();
  private activeRegions: Location.LocationRegion[] = [];
  private onExitCallback: (() => void) | null = null;
  private onEnterCallback: ((placeId: string) => void) | null = null;

  async init(): Promise<void> {
    const ids = await database.getGeofencedPlaceIds();
    for (const id of ids) {
      this.geofencedPlaceIds.add(id);
      const place = await database.getPlace(id);
      if (place) {
        this.activeRegions.push({
          identifier: `${GEOFENCE_PREFIX}${place.id}`,
          latitude: place.latitude,
          longitude: place.longitude,
          radius: Math.max(MIN_RADIUS, place.radius * 2),
          notifyOnEnter: true,
          notifyOnExit: true,
        });
      }
    }

    if (this.activeRegions.length > 0) {
      try {
        await Location.startGeofencingAsync(
          BACKGROUND_GEOFENCING_TASK,
          this.activeRegions,
        );
      } catch (err) {
        console.warn('[Geofence] Failed to start geofencing:', err);
      }
    }
  }

  onGeofenceExit(cb: () => void): void {
    this.onExitCallback = cb;
  }

  onGeofenceEnter(cb: (placeId: string) => void): void {
    this.onEnterCallback = cb;
  }

  handleGeofenceEvent(
    eventType: Location.GeofencingEventType,
    region: Location.LocationRegion,
  ): void {
    const id = region.identifier || '';
    if (!id.startsWith(GEOFENCE_PREFIX)) return;

    const placeId = id.slice(GEOFENCE_PREFIX.length);

    if (eventType === Location.GeofencingEventType.Exit) {
      console.log('[Geofence] Exited known place:', placeId);
      this.onExitCallback?.();
    } else if (eventType === Location.GeofencingEventType.Enter) {
      console.log('[Geofence] Entered known place:', placeId);
      this.onEnterCallback?.(placeId);
    }
  }

  qualifiesForGeofence(place: Place): boolean {
    if (place.category === 'home' || place.category === 'work') return true;
    if (place.visitCount >= 3) return true;
    return false;
  }

  async ensureGeofence(place: Place): Promise<void> {
    if (!this.qualifiesForGeofence(place)) return;
    if (this.geofencedPlaceIds.has(place.id)) return;

    // Evict oldest if at iOS limit
    if (this.activeRegions.length >= MAX_GEOFENCES) {
      this.activeRegions.shift();
    }

    const region: Location.LocationRegion = {
      identifier: `${GEOFENCE_PREFIX}${place.id}`,
      latitude: place.latitude,
      longitude: place.longitude,
      radius: Math.max(MIN_RADIUS, place.radius * 2),
      notifyOnEnter: true,
      notifyOnExit: true,
    };

    this.activeRegions.push(region);
    this.geofencedPlaceIds.add(place.id);
    place.isGeofenced = true;

    try {
      await Location.startGeofencingAsync(
        BACKGROUND_GEOFENCING_TASK,
        this.activeRegions,
      );
      await database.addGeofencedPlace(place.id);
      console.log('[Geofence] Added:', place.name, `r=${region.radius}m`);
    } catch (err) {
      console.warn('[Geofence] Failed to add:', err);
    }
  }

  isAtGeofencedPlace(): boolean {
    return this.geofencedPlaceIds.size > 0;
  }
}

export const placeGeofenceManager = new PlaceGeofenceManager();
