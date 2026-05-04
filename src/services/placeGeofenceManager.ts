import BackgroundGeolocation from 'react-native-background-geolocation';
import { Place } from '../models/types';
import { database } from './database';

const GEOFENCE_PREFIX = 'known-place:';
const MIN_RADIUS = 200;

class PlaceGeofenceManager {
  private geofencedPlaceIds = new Set<string>();
  private onExitCallback: (() => void) | null = null;
  private onEnterCallback: ((placeId: string) => void) | null = null;

  async init(): Promise<void> {
    const ids = await database.getGeofencedPlaceIds();
    ids.forEach(id => this.geofencedPlaceIds.add(id));
  }

  onGeofenceExit(cb: () => void): void {
    this.onExitCallback = cb;
  }

  onGeofenceEnter(cb: (placeId: string) => void): void {
    this.onEnterCallback = cb;
  }

  async handleGeofenceEvent(event: any): Promise<void> {
    const id: string = event.identifier || '';
    if (!id.startsWith(GEOFENCE_PREFIX)) return;

    const placeId = id.slice(GEOFENCE_PREFIX.length);
    const action: string = event.action;

    if (action === 'EXIT') {
      console.log('[Geofence] Exited known place:', placeId);
      this.onExitCallback?.();
    } else if (action === 'ENTER') {
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

    const identifier = `${GEOFENCE_PREFIX}${place.id}`;
    const radius = Math.max(MIN_RADIUS, place.radius * 2);

    try {
      await BackgroundGeolocation.addGeofence({
        identifier,
        radius,
        latitude: place.latitude,
        longitude: place.longitude,
        notifyOnEntry: true,
        notifyOnExit: true,
        notifyOnDwell: false,
      });

      this.geofencedPlaceIds.add(place.id);
      place.isGeofenced = true;
      await database.addGeofencedPlace(place.id);
      console.log('[Geofence] Added:', place.name, `r=${radius}m`);
    } catch (err) {
      console.warn('[Geofence] Failed to add:', err);
    }
  }

  isAtGeofencedPlace(): boolean {
    return this.geofencedPlaceIds.size > 0;
  }

}

export const placeGeofenceManager = new PlaceGeofenceManager();
