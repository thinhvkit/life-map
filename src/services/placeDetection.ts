import { Place, PlaceCategory, GpsPoint } from '../models/types';
import { generateId } from '../utils/geo';
import { database } from './database';
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/reverse';

const MIN_DWELL_SECONDS = 120;
const DEFAULT_MERGE_RADIUS = 50;
const MAX_MERGE_RADIUS = 200;
const MIN_MERGE_RADIUS = 25;
const GEOCODE_CACHE_TTL = 86400000; // 24h
const GEOCODE_MIN_INTERVAL = 1500; // Nominatim rate limit: 1 req/s
const PENDING_LABEL = 'Pending...';
const RETRY_INTERVAL = 30000; // 30s

interface GpsCluster {
  centroid: { latitude: number; longitude: number };
  radius: number;
  pointCount: number;
}

interface GeocodeResult {
  name: string;
  address?: string;
  type?: string;
  osmClass?: string;
}

interface GeocodeCache {
  key: string;
  result: GeocodeResult;
  timestamp: number;
}

interface PendingGeocode {
  placeId: string;
  latitude: number;
  longitude: number;
}

class PlaceDetectionService {
  private knownPlaces: Place[] = [];
  private geocodeCache: GeocodeCache[] = [];
  private lastGeocodeTime = 0;
  private initialized = false;
  private pendingQueue: PendingGeocode[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    database.init();
    this.knownPlaces = await database.getAllPlaces();
    this.initialized = true;

    const pending = this.knownPlaces.filter(p => p.name === PENDING_LABEL);
    for (const p of pending) {
      this.enqueue(p.id, p.latitude, p.longitude);
    }
  }

  async evaluateVisit(
    points: GpsPoint[],
    startTime: number,
    endTime: number,
  ): Promise<Place | null> {
    const dwellSeconds = (endTime - startTime) / 1000;
    if (dwellSeconds < MIN_DWELL_SECONDS) {
      return null;
    }

    const cluster = this.computeCluster(points);
    if (!cluster) return null;

    const existing = this.findNearbyPlace(
      cluster.centroid.latitude,
      cluster.centroid.longitude,
    );

    if (existing) {
      existing.visitCount += 1;
      existing.lastVisit = endTime;
      existing.totalDuration += endTime - startTime;
      this.refinePlace(existing, cluster);
      await database.upsertPlace(existing);
      return existing;
    }

    const placeId = generateId();
    const geocoded = await this.reverseGeocode(
      cluster.centroid.latitude,
      cluster.centroid.longitude,
    );

    const isPending = geocoded.name === PENDING_LABEL;

    const place: Place = {
      id: placeId,
      name: isPending ? PENDING_LABEL : (geocoded.name || 'Unknown Place'),
      address: geocoded.address,
      latitude: cluster.centroid.latitude,
      longitude: cluster.centroid.longitude,
      radius: Math.max(MIN_MERGE_RADIUS, Math.min(cluster.radius * 1.5, MAX_MERGE_RADIUS)),
      category: isPending ? 'other' : this.inferCategory(geocoded.type, geocoded.osmClass),
      visitCount: 1,
      totalDuration: endTime - startTime,
      firstVisit: startTime,
      lastVisit: endTime,
    };

    this.knownPlaces.push(place);
    await database.upsertPlace(place);

    if (isPending) {
      this.enqueue(placeId, cluster.centroid.latitude, cluster.centroid.longitude);
    }

    console.log(`[Place] New: "${place.name}" (${place.category}) r=${Math.round(place.radius)}m, dwell=${Math.round(dwellSeconds)}s`);
    return place;
  }

  private computeCluster(points: GpsPoint[]): GpsCluster | null {
    if (points.length === 0) return null;

    if (points.length === 1) {
      return {
        centroid: { latitude: points[0].latitude, longitude: points[0].longitude },
        radius: DEFAULT_MERGE_RADIUS,
        pointCount: 1,
      };
    }

    // First pass: raw centroid
    let sumLat = 0;
    let sumLon = 0;
    for (const p of points) {
      sumLat += p.latitude;
      sumLon += p.longitude;
    }
    let centLat = sumLat / points.length;
    let centLon = sumLon / points.length;

    // Compute distances from centroid
    const distances = points.map(p => ({
      point: p,
      dist: quickDistance(p.latitude, p.longitude, centLat, centLon),
    }));

    // Reject outliers beyond 2× median distance (GPS spikes)
    distances.sort((a, b) => a.dist - b.dist);
    const medianDist = distances[Math.floor(distances.length / 2)].dist;
    const threshold = Math.max(medianDist * 2, 30);
    const inliers = distances.filter(d => d.dist <= threshold);

    if (inliers.length === 0) return null;

    // Second pass: refined centroid from inliers only
    sumLat = 0;
    sumLon = 0;
    for (const d of inliers) {
      sumLat += d.point.latitude;
      sumLon += d.point.longitude;
    }
    centLat = sumLat / inliers.length;
    centLon = sumLon / inliers.length;

    // Scatter radius: distance that contains 90% of inlier points
    const inlierDists = inliers
      .map(d => quickDistance(d.point.latitude, d.point.longitude, centLat, centLon))
      .sort((a, b) => a - b);
    const p90Index = Math.floor(inlierDists.length * 0.9);
    const scatterRadius = inlierDists[p90Index] || DEFAULT_MERGE_RADIUS;

    return {
      centroid: { latitude: centLat, longitude: centLon },
      radius: Math.max(scatterRadius, MIN_MERGE_RADIUS),
      pointCount: inliers.length,
    };
  }

  private refinePlace(place: Place, cluster: GpsCluster): void {
    // Weighted average: shift centroid slightly toward new cluster
    // Weight existing position more heavily with more visits
    const weight = Math.min(place.visitCount, 10);
    place.latitude =
      (place.latitude * weight + cluster.centroid.latitude) / (weight + 1);
    place.longitude =
      (place.longitude * weight + cluster.centroid.longitude) / (weight + 1);

    // Adapt radius: blend existing with observed scatter
    const newRadius = Math.max(
      MIN_MERGE_RADIUS,
      Math.min((place.radius * weight + cluster.radius * 1.5) / (weight + 1), MAX_MERGE_RADIUS),
    );
    place.radius = newRadius;
  }

  private findNearbyPlace(lat: number, lon: number): Place | null {
    let closest: Place | null = null;
    let closestDist = Infinity;

    for (const place of this.knownPlaces) {
      const dist = quickDistance(lat, lon, place.latitude, place.longitude);
      if (dist < place.radius && dist < closestDist) {
        closest = place;
        closestDist = dist;
      }
    }

    return closest;
  }

  private async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<GeocodeResult> {
    // Check cache first (grid-snapped to ~50m cells)
    const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const now = Date.now();
    const cached = this.geocodeCache.find(
      c => c.key === cacheKey && now - c.timestamp < GEOCODE_CACHE_TTL,
    );
    if (cached) return cached.result;

    // Rate limit
    const elapsed = now - this.lastGeocodeTime;
    if (elapsed < GEOCODE_MIN_INTERVAL) {
      await new Promise<void>(r => setTimeout(r, GEOCODE_MIN_INTERVAL - elapsed));
    }
    this.lastGeocodeTime = Date.now();

    try {
      const res = await fetch(
        `${GEOCODE_URL}?lat=${latitude}&lon=${longitude}&format=json&zoom=18&addressdetails=1&extratags=1&namedetails=1`,
        { headers: { 'User-Agent': 'LifeMap-RN/1.0' } },
      );
      const data = await res.json();

      const name = this.extractBestName(data);
      const address = data.display_name;
      const type = data.type;
      const osmClass = data.class;

      const result: GeocodeResult = { name, address, type, osmClass };

      // Cache (keep max 100 entries)
      this.geocodeCache.push({ key: cacheKey, result, timestamp: Date.now() });
      if (this.geocodeCache.length > 100) {
        this.geocodeCache = this.geocodeCache.slice(-80);
      }

      return result;
    } catch {
      return { name: PENDING_LABEL };
    }
  }

  private enqueue(placeId: string, latitude: number, longitude: number): void {
    if (this.pendingQueue.some(p => p.placeId === placeId)) return;
    this.pendingQueue.push({ placeId, latitude, longitude });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.pendingQueue.length === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushPending();
    }, RETRY_INTERVAL);
  }

  private async flushPending(): Promise<void> {
    if (this.pendingQueue.length === 0) return;

    const item = this.pendingQueue[0];
    const geocoded = await this.reverseGeocode(item.latitude, item.longitude);

    if (geocoded.name === PENDING_LABEL) {
      this.scheduleRetry();
      return;
    }

    this.pendingQueue.shift();
    const place = this.knownPlaces.find(p => p.id === item.placeId);
    if (place) {
      place.name = geocoded.name || 'Unknown Place';
      place.address = geocoded.address;
      place.category = this.inferCategory(geocoded.type, geocoded.osmClass);
      await database.upsertPlace(place);
      console.log(`[Place] Resolved pending: "${place.name}" (${place.category})`);
    }

    if (this.pendingQueue.length > 0) {
      this.scheduleRetry();
    }
  }

  private extractBestName(data: any): string {
    // Priority: POI name > namedetails > address components > road
    if (data.namedetails?.name) return data.namedetails.name;
    if (data.name && data.name !== data.address?.road) return data.name;

    const addr = data.address;
    if (!addr) return 'Unknown Place';

    // POI-level names
    if (addr.amenity) return addr.amenity;
    if (addr.shop) return addr.shop;
    if (addr.leisure) return addr.leisure;
    if (addr.tourism) return addr.tourism;
    if (addr.building && addr.building !== 'yes') return addr.building;

    // Fall back to house number + road
    if (addr.house_number && addr.road) {
      return `${addr.house_number} ${addr.road}`;
    }
    if (addr.road) return addr.road;

    return data.display_name?.split(',')[0] || 'Unknown Place';
  }

  private inferCategory(type?: string, osmClass?: string): PlaceCategory {
    if (!type && !osmClass) return 'other';

    const combined = `${osmClass || ''}:${type || ''}`.toLowerCase();

    // Class-based inference (more reliable than type alone)
    if (osmClass) {
      const classMap: Record<string, PlaceCategory> = {
        amenity: 'other',
        shop: 'shopping',
        leisure: 'entertainment',
        tourism: 'entertainment',
        office: 'work',
        building: 'other',
      };
      const classCategory = classMap[osmClass.toLowerCase()];
      if (classCategory === 'shopping') return 'shopping';
    }

    // Type-based inference
    const typeMap: Record<string, PlaceCategory> = {
      restaurant: 'food',
      cafe: 'food',
      fast_food: 'food',
      bar: 'food',
      pub: 'food',
      food_court: 'food',
      ice_cream: 'food',
      bakery: 'food',
      coffee: 'food',
      supermarket: 'shopping',
      shop: 'shopping',
      mall: 'shopping',
      convenience: 'shopping',
      marketplace: 'shopping',
      department_store: 'shopping',
      clothes: 'shopping',
      station: 'transit',
      bus_stop: 'transit',
      bus_station: 'transit',
      airport: 'transit',
      taxi: 'transit',
      subway_entrance: 'transit',
      ferry_terminal: 'transit',
      parking: 'transit',
      gym: 'fitness',
      fitness_centre: 'fitness',
      sports_centre: 'fitness',
      swimming_pool: 'fitness',
      pitch: 'fitness',
      stadium: 'fitness',
      cinema: 'entertainment',
      theatre: 'entertainment',
      park: 'entertainment',
      museum: 'entertainment',
      gallery: 'entertainment',
      nightclub: 'entertainment',
      library: 'entertainment',
      zoo: 'entertainment',
      theme_park: 'entertainment',
      house: 'home',
      residential: 'home',
      apartment: 'home',
      apartments: 'home',
      detached: 'home',
      dormitory: 'home',
      office: 'work',
      commercial: 'work',
      industrial: 'work',
      coworking_space: 'work',
      university: 'work',
      school: 'work',
      college: 'work',
      hospital: 'other',
      clinic: 'other',
      pharmacy: 'other',
      place_of_worship: 'other',
    };

    const t = (type || '').toLowerCase();
    if (typeMap[t]) return typeMap[t];

    // Check combined for partial matches
    if (combined.includes('food') || combined.includes('restaurant') || combined.includes('cafe')) return 'food';
    if (combined.includes('shop') || combined.includes('retail') || combined.includes('market')) return 'shopping';

    return 'other';
  }

  async labelPlace(placeId: string, category: PlaceCategory): Promise<void> {
    const place = this.knownPlaces.find(p => p.id === placeId);
    if (place) {
      place.category = category;
      await database.upsertPlace(place);
    }
  }

  getKnownPlaces(): Place[] {
    return [...this.knownPlaces];
  }

  getPlace(placeId: string): Place | undefined {
    return this.knownPlaces.find(p => p.id === placeId);
  }

  findNearby(lat: number, lon: number, radiusMeters: number = DEFAULT_MERGE_RADIUS): Place | null {
    for (const place of this.knownPlaces) {
      const dist = quickDistance(lat, lon, place.latitude, place.longitude);
      if (dist < radiusMeters) return place;
    }
    return null;
  }

}

function quickDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dlat = (lat2 - lat1) * 111320;
  const dlon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

export const placeDetectionService = new PlaceDetectionService();
