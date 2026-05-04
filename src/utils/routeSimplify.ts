interface LatLng {
  latitude: number;
  longitude: number;
}

export function simplifyRoute(points: LatLng[], tolerance: number): LatLng[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyRoute(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyRoute(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(
  point: LatLng,
  lineStart: LatLng,
  lineEnd: LatLng,
): number {
  const dx = lineEnd.longitude - lineStart.longitude;
  const dy = lineEnd.latitude - lineStart.latitude;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      (point.longitude - lineStart.longitude) ** 2 +
        (point.latitude - lineStart.latitude) ** 2,
    );
  }

  const t =
    ((point.longitude - lineStart.longitude) * dx +
      (point.latitude - lineStart.latitude) * dy) /
    (dx * dx + dy * dy);

  const nearestLon = lineStart.longitude + t * dx;
  const nearestLat = lineStart.latitude + t * dy;

  return Math.sqrt(
    (point.longitude - nearestLon) ** 2 + (point.latitude - nearestLat) ** 2,
  );
}
