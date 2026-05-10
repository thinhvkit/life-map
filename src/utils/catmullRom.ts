interface LatLng {
  latitude: number;
  longitude: number;
}

export function catmullRomSpline(
  points: LatLng[],
  pointsPerSegment = 6,
  alpha = 0.5,
): [number, number][] {
  if (points.length < 2) {
    return points.map(p => [p.longitude, p.latitude]);
  }
  if (points.length === 2) {
    return points.map(p => [p.longitude, p.latitude]);
  }

  const result: [number, number][] = [];

  const extended: LatLng[] = [
    reflect(points[1], points[0]),
    ...points,
    reflect(points[points.length - 2], points[points.length - 1]),
  ];

  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];

    const isFirst = i === 1;
    const isLast = i === extended.length - 3;
    const steps = pointsPerSegment;

    for (let s = 0; s < steps; s++) {
      if (s === 0 && !isFirst) continue;
      const t = s / steps;
      const pt = centripetal(p0, p1, p2, p3, t, alpha);
      result.push(pt);
    }

    if (isLast) {
      result.push([p2.longitude, p2.latitude]);
    }
  }

  return result;
}

function reflect(anchor: LatLng, point: LatLng): LatLng {
  return {
    latitude: 2 * point.latitude - anchor.latitude,
    longitude: 2 * point.longitude - anchor.longitude,
  };
}

function centripetal(
  p0: LatLng,
  p1: LatLng,
  p2: LatLng,
  p3: LatLng,
  t: number,
  alpha: number,
): [number, number] {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1, alpha);
  const t2 = t1 + knot(p1, p2, alpha);
  const t3 = t2 + knot(p2, p3, alpha);

  const u = t1 + t * (t2 - t1);

  const a1Lat = lerp(p0.latitude, p1.latitude, t0, t1, u);
  const a1Lon = lerp(p0.longitude, p1.longitude, t0, t1, u);
  const a2Lat = lerp(p1.latitude, p2.latitude, t1, t2, u);
  const a2Lon = lerp(p1.longitude, p2.longitude, t1, t2, u);
  const a3Lat = lerp(p2.latitude, p3.latitude, t2, t3, u);
  const a3Lon = lerp(p2.longitude, p3.longitude, t2, t3, u);

  const b1Lat = lerp(a1Lat, a2Lat, t0, t2, u);
  const b1Lon = lerp(a1Lon, a2Lon, t0, t2, u);
  const b2Lat = lerp(a2Lat, a3Lat, t1, t3, u);
  const b2Lon = lerp(a2Lon, a3Lon, t1, t3, u);

  const cLat = lerp(b1Lat, b2Lat, t1, t2, u);
  const cLon = lerp(b1Lon, b2Lon, t1, t2, u);

  return [cLon, cLat];
}

function knot(a: LatLng, b: LatLng, alpha: number): number {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;
  return Math.pow(dx * dx + dy * dy, alpha / 2) || 1e-10;
}

function lerp(
  v0: number,
  v1: number,
  t0: number,
  t1: number,
  t: number,
): number {
  const d = t1 - t0;
  if (Math.abs(d) < 1e-15) return v0;
  return v0 + ((v1 - v0) * (t - t0)) / d;
}
