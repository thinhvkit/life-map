import { Segment, DayLog, GpsPoint, Place, ActivityType } from '../models/types';
import { format } from 'date-fns';

function pt(
  lat: number,
  lng: number,
  ts: number,
  activity: ActivityType = 'walking',
  speed = 1.4,
): GpsPoint {
  return {
    id: `gps-${ts}-${Math.random().toString(36).slice(2, 7)}`,
    latitude: lat,
    longitude: lng,
    altitude: 10,
    accuracy: 8,
    speed,
    heading: 0,
    timestamp: ts,
    batteryLevel: 85,
    isMoving: speed > 0.3,
    activity,
    confidence: 90,
  };
}

function yesterdayAt(h: number, m: number): number {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function interpolate(
  start: [number, number],
  end: [number, number],
  steps: number,
  startTime: number,
  intervalMs: number,
  activity: ActivityType,
  speed: number,
): GpsPoint[] {
  const points: GpsPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = start[0] + (end[0] - start[0]) * t;
    const lng = start[1] + (end[1] - start[1]) * t;
    points.push(pt(lat, lng, startTime + i * intervalMs, activity, speed));
  }
  return points;
}

function polyline(
  waypoints: [number, number][],
  startTime: number,
  endTime: number,
  activity: ActivityType,
  speed: number,
): GpsPoint[] {
  const totalDuration = endTime - startTime;
  let totalDist = 0;
  const segDists: number[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const d = Math.sqrt(
      Math.pow(waypoints[i][0] - waypoints[i - 1][0], 2) +
        Math.pow(waypoints[i][1] - waypoints[i - 1][1], 2),
    );
    segDists.push(d);
    totalDist += d;
  }

  const points: GpsPoint[] = [];
  let elapsed = 0;
  for (let i = 0; i < segDists.length; i++) {
    const segTime = (segDists[i] / totalDist) * totalDuration;
    const steps = Math.max(3, Math.round(segTime / 15000));
    const segPoints = interpolate(
      waypoints[i],
      waypoints[i + 1],
      steps,
      startTime + elapsed,
      segTime / steps,
      activity,
      speed,
    );
    if (i > 0) segPoints.shift();
    points.push(...segPoints);
    elapsed += segTime;
  }
  return points;
}

export function generateMockDayLog(): DayLog {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateKey = format(yesterday, 'yyyy-MM-dd');

  // Places
  const home: Place = {
    id: 'place-home',
    name: 'Home',
    address: '123 Nguyen Hue, District 1',
    latitude: 10.7731,
    longitude: 106.7030,
    radius: 50,
    category: 'home',
    visitCount: 45,
    totalDuration: 3600000 * 8,
    firstVisit: Date.now() - 86400000 * 30,
    lastVisit: Date.now(),
    isGeofenced: true,
  };

  const coffee: Place = {
    id: 'place-coffee',
    name: 'The Coffee House',
    address: '86 Le Loi, District 1',
    latitude: 10.7735,
    longitude: 106.6995,
    radius: 30,
    category: 'food',
    visitCount: 12,
    totalDuration: 3600000 * 2,
    firstVisit: Date.now() - 86400000 * 20,
    lastVisit: Date.now(),
  };

  const office: Place = {
    id: 'place-office',
    name: 'Saigon Technology',
    address: '111 Ly Chinh Thang, District 3',
    latitude: 10.7845,
    longitude: 106.6870,
    radius: 60,
    category: 'work',
    visitCount: 22,
    totalDuration: 3600000 * 160,
    firstVisit: Date.now() - 86400000 * 60,
    lastVisit: Date.now(),
    isGeofenced: true,
  };

  const lunch: Place = {
    id: 'place-lunch',
    name: 'Pho Hung',
    address: '241 Nguyen Trai, District 1',
    latitude: 10.7680,
    longitude: 106.6880,
    radius: 25,
    category: 'food',
    visitCount: 8,
    totalDuration: 3600000,
    firstVisit: Date.now() - 86400000 * 15,
    lastVisit: Date.now(),
  };

  const gym: Place = {
    id: 'place-gym',
    name: 'California Fitness',
    address: '26 Ly Tu Trong, District 1',
    latitude: 10.7760,
    longitude: 106.7000,
    radius: 40,
    category: 'fitness',
    visitCount: 10,
    totalDuration: 3600000 * 10,
    firstVisit: Date.now() - 86400000 * 25,
    lastVisit: Date.now(),
  };

  // Segments for a full day

  // 1. Home (overnight → 7:00)
  const seg1: Segment = {
    id: 'seg-01-home-morning',
    type: 'visit',
    startTime: yesterdayAt(0, 0),
    endTime: yesterdayAt(7, 0),
    activity: 'stationary',
    points: [pt(home.latitude, home.longitude, yesterdayAt(0, 0), 'stationary', 0)],
    place: home,
  };

  // 2. Walk to coffee (7:00 → 7:12)
  const walkToCoffeePoints = polyline(
    [
      [10.7731, 106.7030],
      [10.7733, 106.7018],
      [10.7735, 106.7005],
      [10.7735, 106.6995],
    ],
    yesterdayAt(7, 0),
    yesterdayAt(7, 12),
    'walking',
    1.3,
  );
  const seg2: Segment = {
    id: 'seg-02-walk-coffee',
    type: 'trip',
    startTime: yesterdayAt(7, 0),
    endTime: yesterdayAt(7, 12),
    activity: 'walking',
    points: walkToCoffeePoints,
    simplifiedPoints: walkToCoffeePoints.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    distance: 380,
  };

  // 3. Coffee shop (7:12 → 7:45)
  const seg3: Segment = {
    id: 'seg-03-coffee',
    type: 'visit',
    startTime: yesterdayAt(7, 12),
    endTime: yesterdayAt(7, 45),
    activity: 'stationary',
    points: [pt(coffee.latitude, coffee.longitude, yesterdayAt(7, 12), 'stationary', 0)],
    place: coffee,
  };

  // 4. Cycle to office (7:45 → 8:10)
  const cycleToOfficePoints = polyline(
    [
      [10.7735, 106.6995],
      [10.7750, 106.6975],
      [10.7770, 106.6950],
      [10.7800, 106.6920],
      [10.7825, 106.6895],
      [10.7845, 106.6870],
    ],
    yesterdayAt(7, 45),
    yesterdayAt(8, 10),
    'cycling',
    4.2,
  );
  const seg4: Segment = {
    id: 'seg-04-cycle-office',
    type: 'trip',
    startTime: yesterdayAt(7, 45),
    endTime: yesterdayAt(8, 10),
    activity: 'cycling',
    points: cycleToOfficePoints,
    simplifiedPoints: cycleToOfficePoints.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    distance: 2100,
  };

  // 5. Office morning (8:10 → 12:00)
  const seg5: Segment = {
    id: 'seg-05-office-morning',
    type: 'visit',
    startTime: yesterdayAt(8, 10),
    endTime: yesterdayAt(12, 0),
    activity: 'stationary',
    points: [pt(office.latitude, office.longitude, yesterdayAt(8, 10), 'stationary', 0)],
    place: office,
  };

  // 6. Walk to lunch (12:00 → 12:15)
  const walkToLunchPoints = polyline(
    [
      [10.7845, 106.6870],
      [10.7820, 106.6870],
      [10.7790, 106.6875],
      [10.7750, 106.6878],
      [10.7710, 106.6880],
      [10.7680, 106.6880],
    ],
    yesterdayAt(12, 0),
    yesterdayAt(12, 15),
    'walking',
    1.5,
  );
  const seg6: Segment = {
    id: 'seg-06-walk-lunch',
    type: 'trip',
    startTime: yesterdayAt(12, 0),
    endTime: yesterdayAt(12, 15),
    activity: 'walking',
    points: walkToLunchPoints,
    simplifiedPoints: walkToLunchPoints.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    distance: 1850,
  };

  // 7. Lunch (12:15 → 13:00)
  const seg7: Segment = {
    id: 'seg-07-lunch',
    type: 'visit',
    startTime: yesterdayAt(12, 15),
    endTime: yesterdayAt(13, 0),
    activity: 'stationary',
    points: [pt(lunch.latitude, lunch.longitude, yesterdayAt(12, 15), 'stationary', 0)],
    place: lunch,
  };

  // 8. Walk back to office (13:00 → 13:15)
  const walkBackPoints = polyline(
    [
      [10.7680, 106.6880],
      [10.7710, 106.6878],
      [10.7750, 106.6875],
      [10.7790, 106.6872],
      [10.7820, 106.6870],
      [10.7845, 106.6870],
    ],
    yesterdayAt(13, 0),
    yesterdayAt(13, 15),
    'walking',
    1.5,
  );
  const seg8: Segment = {
    id: 'seg-08-walk-back-office',
    type: 'trip',
    startTime: yesterdayAt(13, 0),
    endTime: yesterdayAt(13, 15),
    activity: 'walking',
    points: walkBackPoints,
    simplifiedPoints: walkBackPoints.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    distance: 1850,
  };

  // 9. Office afternoon (13:15 → 17:30)
  const seg9: Segment = {
    id: 'seg-09-office-afternoon',
    type: 'visit',
    startTime: yesterdayAt(13, 15),
    endTime: yesterdayAt(17, 30),
    activity: 'stationary',
    points: [pt(office.latitude, office.longitude, yesterdayAt(13, 15), 'stationary', 0)],
    place: office,
  };

  // 10. Drive to gym (17:30 → 17:50)
  const driveToGymPoints = polyline(
    [
      [10.7845, 106.6870],
      [10.7830, 106.6900],
      [10.7810, 106.6930],
      [10.7790, 106.6960],
      [10.7770, 106.6985],
      [10.7760, 106.7000],
    ],
    yesterdayAt(17, 30),
    yesterdayAt(17, 50),
    'driving',
    8.5,
  );
  const seg10: Segment = {
    id: 'seg-10-drive-gym',
    type: 'trip',
    startTime: yesterdayAt(17, 30),
    endTime: yesterdayAt(17, 50),
    activity: 'driving',
    points: driveToGymPoints,
    simplifiedPoints: driveToGymPoints.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    distance: 1600,
  };

  // 11. Gym (17:50 → 19:00)
  const seg11: Segment = {
    id: 'seg-11-gym',
    type: 'visit',
    startTime: yesterdayAt(17, 50),
    endTime: yesterdayAt(19, 0),
    activity: 'stationary',
    points: [pt(gym.latitude, gym.longitude, yesterdayAt(17, 50), 'stationary', 0)],
    place: gym,
  };

  // 12. Walk home (19:00 → 19:18)
  const walkHomePoints = polyline(
    [
      [10.7760, 106.7000],
      [10.7755, 106.7010],
      [10.7745, 106.7020],
      [10.7738, 106.7025],
      [10.7731, 106.7030],
    ],
    yesterdayAt(19, 0),
    yesterdayAt(19, 18),
    'walking',
    1.3,
  );
  const seg12: Segment = {
    id: 'seg-12-walk-home',
    type: 'trip',
    startTime: yesterdayAt(19, 0),
    endTime: yesterdayAt(19, 18),
    activity: 'walking',
    points: walkHomePoints,
    simplifiedPoints: walkHomePoints.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    distance: 420,
  };

  // 13. Home evening (19:18 → now)
  const seg13: Segment = {
    id: 'seg-13-home-evening',
    type: 'visit',
    startTime: yesterdayAt(19, 18),
    endTime: yesterdayAt(23, 59),
    activity: 'stationary',
    points: [pt(home.latitude, home.longitude, yesterdayAt(19, 18), 'stationary', 0)],
    place: home,
  };

  const segments = [seg1, seg2, seg3, seg4, seg5, seg6, seg7, seg8, seg9, seg10, seg11, seg12, seg13];

  const totalDistance = 380 + 2100 + 1850 + 1850 + 1600 + 420;
  const totalMovingTime =
    (yesterdayAt(7, 12) - yesterdayAt(7, 0)) +
    (yesterdayAt(8, 10) - yesterdayAt(7, 45)) +
    (yesterdayAt(12, 15) - yesterdayAt(12, 0)) +
    (yesterdayAt(13, 15) - yesterdayAt(13, 0)) +
    (yesterdayAt(17, 50) - yesterdayAt(17, 30)) +
    (yesterdayAt(19, 18) - yesterdayAt(19, 0));
  const totalStationaryTime =
    (yesterdayAt(7, 0) - yesterdayAt(0, 0)) +
    (yesterdayAt(7, 45) - yesterdayAt(7, 12)) +
    (yesterdayAt(12, 0) - yesterdayAt(8, 10)) +
    (yesterdayAt(13, 0) - yesterdayAt(12, 15)) +
    (yesterdayAt(17, 30) - yesterdayAt(13, 15)) +
    (yesterdayAt(19, 0) - yesterdayAt(17, 50)) +
    (yesterdayAt(23, 59) - yesterdayAt(19, 18));

  const activityBreakdown: Record<ActivityType, number> = {
    stationary: totalStationaryTime,
    walking:
      (yesterdayAt(7, 12) - yesterdayAt(7, 0)) +
      (yesterdayAt(12, 15) - yesterdayAt(12, 0)) +
      (yesterdayAt(13, 15) - yesterdayAt(13, 0)) +
      (yesterdayAt(19, 18) - yesterdayAt(19, 0)),
    cycling: yesterdayAt(8, 10) - yesterdayAt(7, 45),
    driving: yesterdayAt(17, 50) - yesterdayAt(17, 30),
    running: 0,
    bus: 0,
    train: 0,
    airplane: 0,
    unknown: 0,
  };

  return {
    date: dateKey,
    segments,
    totalDistance,
    totalMovingTime,
    totalStationaryTime,
    placesVisited: 5,
    activityBreakdown,
  };
}
