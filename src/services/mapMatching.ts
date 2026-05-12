import { MAPBOX_ACCESS_TOKEN } from '../config.local';
import { ActivityType } from '../models/types';

const MAX_COORDS_PER_REQUEST = 100;

type Profile = 'mapbox/driving' | 'mapbox/walking' | 'mapbox/cycling';

function activityToProfile(activity: ActivityType): Profile {
  switch (activity) {
    case 'walking':
    case 'running':
      return 'mapbox/walking';
    case 'cycling':
      return 'mapbox/cycling';
    default:
      return 'mapbox/driving';
  }
}

interface MatchedRoute {
  coordinates: { latitude: number; longitude: number }[];
  distance: number;
  confidence: number;
}

export async function matchToRoads(
  points: { latitude: number; longitude: number }[],
  activity: ActivityType,
): Promise<MatchedRoute | null> {
  if (points.length < 2) return null;

  const profile = activityToProfile(activity);

  if (points.length <= MAX_COORDS_PER_REQUEST) {
    return matchBatch(points, profile);
  }

  // For long trips, split into overlapping batches and merge
  const allCoords: { latitude: number; longitude: number }[] = [];
  let totalDistance = 0;
  let totalConfidence = 0;
  let batchCount = 0;
  const step = MAX_COORDS_PER_REQUEST - 5; // 5-point overlap for continuity

  for (let i = 0; i < points.length; i += step) {
    const batch = points.slice(i, i + MAX_COORDS_PER_REQUEST);
    if (batch.length < 2) break;

    const result = await matchBatch(batch, profile);
    if (!result) continue;

    if (allCoords.length > 0 && result.coordinates.length > 0) {
      // Skip overlap points from the new batch
      const overlapCount = Math.min(5, allCoords.length);
      const lastExisting = allCoords[allCoords.length - 1];
      let skipTo = 0;
      for (let j = 0; j < result.coordinates.length && j < 10; j++) {
        const c = result.coordinates[j];
        const dist = quickDist(lastExisting, c);
        if (dist < 0.0001) {
          skipTo = j + 1;
          break;
        }
      }
      allCoords.push(...result.coordinates.slice(skipTo || overlapCount));
    } else {
      allCoords.push(...result.coordinates);
    }

    totalDistance += result.distance;
    totalConfidence += result.confidence;
    batchCount++;
  }

  if (allCoords.length === 0) return null;

  return {
    coordinates: allCoords,
    distance: totalDistance,
    confidence: batchCount > 0 ? totalConfidence / batchCount : 0,
  };
}

async function matchBatch(
  points: { latitude: number; longitude: number }[],
  profile: Profile,
): Promise<MatchedRoute | null> {
  const coords = points
    .map(p => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`)
    .join(';');

  const radiuses = points.map(() => '25').join(';');

  const url =
    `https://api.mapbox.com/matching/v5/${profile}/${coords}` +
    `?access_token=${MAPBOX_ACCESS_TOKEN}` +
    `&geometries=geojson` +
    `&radiuses=${radiuses}` +
    `&overview=full` +
    `&steps=false`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[MapMatch] HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
      console.warn(`[MapMatch] No match: ${data.code}`);
      return null;
    }

    const matching = data.matchings[0];
    const geojsonCoords: [number, number][] = matching.geometry.coordinates;

    return {
      coordinates: geojsonCoords.map(([lon, lat]) => ({
        latitude: lat,
        longitude: lon,
      })),
      distance: matching.distance ?? 0,
      confidence: matching.confidence ?? 0,
    };
  } catch (e) {
    console.warn('[MapMatch] Error:', e);
    return null;
  }
}

function quickDist(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dlat = a.latitude - b.latitude;
  const dlon = a.longitude - b.longitude;
  return Math.sqrt(dlat * dlat + dlon * dlon);
}
