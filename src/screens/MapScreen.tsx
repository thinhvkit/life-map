import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  Alert,
} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import { useTrackingStore } from '../store/trackingStore';
import { trackingService } from '../services/tracking';
import { T, ACTIVITY_COLORS, PLACE_COLORS, PLACE_ICONS } from '../utils/theme';
import { formatDistance, formatDuration, formatTime } from '../utils/geo';
import { Segment } from '../models/types';

const HCMC_CENTER: [number, number] = [106.700, 10.777];

export default function MapScreen() {
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [selectedPlace, setSelectedPlace] = useState<Segment | null>(null);

  const isTracking = useTrackingStore(s => s.isTracking);
  const currentPosition = useTrackingStore(s => s.currentPosition);
  const todayLog = useTrackingStore(s => s.todayLog);
  const livePoints = useTrackingStore(s => s.livePoints);

  const trips = useMemo(() => {
    if (!todayLog) return [];
    return todayLog.segments.filter(s => s.type === 'trip');
  }, [todayLog]);

  const uniquePlaces = useMemo(() => {
    if (!todayLog) return [];
    const seen = new Map<string, Segment>();
    todayLog.segments
      .filter(s => s.type === 'visit' && s.place)
      .forEach(s => {
        if (!seen.has(s.place!.name)) seen.set(s.place!.name, s);
      });
    return [...seen.values()];
  }, [todayLog]);

  const liveShape = useMemo(() => {
    if (livePoints.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: livePoints.map(p => [p.longitude, p.latitude]),
      },
    };
  }, [livePoints]);

  const handleSelectPlace = useCallback((seg: Segment) => {
    setSelectedPlace(prev =>
      prev?.place?.name === seg.place?.name ? null : seg,
    );
  }, []);

  const stats = useMemo(() => {
    if (!todayLog) {
      return { dist: 0, moving: 0, places: 0 };
    }
    return {
      dist: todayLog.totalDistance,
      moving: todayLog.totalMovingTime,
      places: todayLog.placesVisited,
    };
  }, [todayLog]);

  const handleToggleTracking = useCallback(async () => {
    try {
      if (isTracking) {
        await trackingService.stop();
      } else {
        await trackingService.start();
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      Alert.alert('Tracking Error', msg);
    }
  }, [isTracking]);

  const handleCenterOnUser = useCallback(async () => {
    try {
      const pos = await trackingService.getCurrentPosition();
      cameraRef.current?.setCamera({
        centerCoordinate: [pos.longitude, pos.latitude],
        zoomLevel: 15,
        animationDuration: 500,
      });
    } catch {
      cameraRef.current?.setCamera({
        centerCoordinate: HCMC_CENTER,
        zoomLevel: 14,
        animationDuration: 500,
      });
    }
  }, []);

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL={MapboxGL.StyleURL.Dark}
        compassEnabled={false}
        rotateEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: HCMC_CENTER,
            zoomLevel: 14,
          }}
        />

        {/* Route polylines */}
        {trips.map(trip => {
          const coords = (trip.simplifiedPoints || trip.points).map(p => [
            p.longitude,
            p.latitude,
          ]);
          if (coords.length < 2) return null;
          const color = ACTIVITY_COLORS[trip.activity];

          return (
            <MapboxGL.ShapeSource
              key={trip.id}
              id={`route-${trip.id}`}
              shape={{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: coords,
                },
              }}
            >
              {/* Glow layer */}
              <MapboxGL.LineLayer
                id={`route-glow-${trip.id}`}
                style={{
                  lineColor: color,
                  lineWidth: 12,
                  lineOpacity: 0.12,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {/* Main line */}
              <MapboxGL.LineLayer
                id={`route-line-${trip.id}`}
                style={{
                  lineColor: color,
                  lineWidth: 4,
                  lineOpacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                  ...(trip.activity === 'walking'
                    ? { lineDasharray: [2, 1.5] }
                    : trip.activity === 'cycling'
                    ? { lineDasharray: [4, 1] }
                    : {}),
                }}
              />
            </MapboxGL.ShapeSource>
          );
        })}

        {/* Live in-progress polyline */}
        {isTracking && liveShape && (
          <MapboxGL.ShapeSource id="live-trip" shape={liveShape}>
            <MapboxGL.LineLayer
              id="live-trip-line"
              style={{
                lineColor: T.accent,
                lineWidth: 4,
                lineOpacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round',
                lineDasharray: [2, 1.5],
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* Place markers */}
        {uniquePlaces.map(seg => (
          <PlaceMarker
            key={seg.place!.name}
            segment={seg}
            isSelected={selectedPlace?.place?.name === seg.place!.name}
            onPress={handleSelectPlace}
          />
        ))}

        {/* Current location */}
        {isTracking && currentPosition && (
          <MapboxGL.MarkerView
            id="current-location"
            coordinate={[
              currentPosition.longitude,
              currentPosition.latitude,
            ]}
          >
            <View style={styles.currentDotOuter}>
              <View style={styles.currentDotInner} />
            </View>
          </MapboxGL.MarkerView>
        )}

        {isTracking && !currentPosition && (
          <MapboxGL.UserLocation visible animated />
        )}
      </MapboxGL.MapView>

      {/* Stats bar overlay */}
      <View style={styles.statsBar}>
        {[
          { v: formatDistance(stats.dist), l: 'Distance' },
          { v: formatDuration(stats.moving), l: 'Moving' },
          { v: `${stats.places}`, l: 'Places' },
          { v: `${Math.round(useTrackingStore.getState().batteryLevel)}%`, l: 'Battery' },
        ].map(s => (
          <View key={s.l} style={styles.statItem}>
            <Text style={styles.statValue}>{s.v}</Text>
            <Text style={styles.statLabel}>{s.l}</Text>
          </View>
        ))}
      </View>

      {/* Place detail popup */}
      {selectedPlace && selectedPlace.place && (
        <PlacePopup
          segment={selectedPlace}
          onClose={() => setSelectedPlace(null)}
        />
      )}

      {/* FABs */}
      <View style={styles.fabContainer}>
        {__DEV__ && (
          <TouchableOpacity
            style={[styles.fabSmall, { backgroundColor: '#7C3AED' }]}
            onPress={() => (global as any).sim?.walk()}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>SIM</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.fabSmall} onPress={handleCenterOnUser}>
          <CrosshairIcon />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.fab,
            { backgroundColor: isTracking ? '#DC2626' : '#16A34A' },
          ]}
          onPress={handleToggleTracking}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>{isTracking ? '■' : '▶'}</Text>
          <Text style={styles.fabText}>{isTracking ? 'Stop' : 'Start'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const PlaceMarker = React.memo(function PlaceMarker({
  segment,
  isSelected,
  onPress,
}: {
  segment: Segment;
  isSelected: boolean;
  onPress: (seg: Segment) => void;
}) {
  const place = segment.place!;
  const color = PLACE_COLORS[place.category || 'other'];
  const icon = PLACE_ICONS[place.category || 'other'];

  return (
    <MapboxGL.MarkerView
      id={`place-${place.id}`}
      coordinate={[place.longitude, place.latitude]}
    >
      <TouchableOpacity
        onPress={() => onPress(segment)}
        activeOpacity={0.8}
        style={styles.markerContainer}
      >
        <View style={[styles.markerOuter, { backgroundColor: color + '1F' }]}>
          <View
            style={[
              styles.markerInner,
              {
                backgroundColor: color,
                borderColor: isSelected ? '#fff' : T.card,
                borderWidth: isSelected ? 2.5 : 2,
              },
            ]}
          >
            <Text style={styles.markerIcon}>{icon}</Text>
          </View>
        </View>
        <Text style={styles.markerLabel} numberOfLines={1}>
          {place.name.length > 14 ? place.name.slice(0, 13) + '…' : place.name}
        </Text>
      </TouchableOpacity>
    </MapboxGL.MarkerView>
  );
});

function PlacePopup({
  segment,
  onClose,
}: {
  segment: Segment;
  onClose: () => void;
}) {
  const place = segment.place!;
  const color = PLACE_COLORS[place.category || 'other'];
  const icon = PLACE_ICONS[place.category || 'other'];
  const dur = segment.endTime - segment.startTime;

  return (
    <Animated.View style={styles.popup}>
      <View style={styles.popupHeader}>
        <View style={[styles.popupIcon, { backgroundColor: color }]}>
          <Text style={styles.popupIconText}>{icon}</Text>
        </View>
        <View style={styles.popupHeaderText}>
          <Text style={styles.popupTitle}>{place.name}</Text>
          <Text style={styles.popupAddress}>{place.address}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.popupClose}>×</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.popupMeta}>
        {[
          { l: 'Arrived', v: formatTime(segment.startTime) },
          { l: 'Left', v: formatTime(segment.endTime) },
          { l: 'Duration', v: formatDuration(dur) },
        ].map(s => (
          <View key={s.l} style={styles.popupPill}>
            <Text style={styles.popupPillValue}>{s.v}</Text>
            <Text style={styles.popupPillLabel}>{s.l}</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function CrosshairIcon() {
  return (
    <View style={styles.crosshair}>
      <View style={styles.crosshairDot} />
      <View style={[styles.crosshairLine, styles.crosshairTop]} />
      <View style={[styles.crosshairLine, styles.crosshairBottom]} />
      <View style={[styles.crosshairLine, styles.crosshairLeft]} />
      <View style={[styles.crosshairLine, styles.crosshairRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  map: { flex: 1 },

  // Stats bar
  statsBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(8,14,28,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.border,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  statItem: { alignItems: 'center' },
  statValue: {
    color: T.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: -0.5,
  },
  statLabel: {
    color: T.textSub,
    fontSize: 10,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Markers
  markerContainer: { alignItems: 'center' },
  markerOuter: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerIcon: { fontSize: 12, color: '#fff' },
  markerLabel: {
    color: T.textSub,
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
    maxWidth: 80,
  },

  // Current location dot
  currentDotOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: T.accent + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentDotInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: T.accent,
    borderWidth: 2.5,
    borderColor: '#fff',
  },

  // Place popup
  popup: {
    position: 'absolute',
    bottom: 80,
    left: 12,
    right: 12,
    backgroundColor: T.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    padding: 14,
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  popupIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupIconText: { fontSize: 18, color: '#fff' },
  popupHeaderText: { flex: 1 },
  popupTitle: { color: T.text, fontSize: 14, fontWeight: '600' },
  popupAddress: { color: T.textSub, fontSize: 12, marginTop: 2 },
  popupClose: {
    color: T.textDim,
    fontSize: 22,
    paddingHorizontal: 4,
  },
  popupMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  popupPill: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  popupPillValue: {
    color: T.text,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  popupPillLabel: {
    color: T.textSub,
    fontSize: 10,
    marginTop: 2,
  },

  // FABs
  fabContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    right: 12,
    alignItems: 'center',
    gap: 10,
  },
  fabSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  fabIcon: { color: '#fff', fontSize: 10 },
  fabText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
  },

  // Crosshair icon
  crosshair: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: T.textSub,
  },
  crosshairLine: {
    position: 'absolute',
    backgroundColor: T.textSub,
  },
  crosshairTop: { top: 0, width: 1.5, height: 4 },
  crosshairBottom: { bottom: 0, width: 1.5, height: 4 },
  crosshairLeft: { left: 0, height: 1.5, width: 4 },
  crosshairRight: { right: 0, height: 1.5, width: 4 },
});
