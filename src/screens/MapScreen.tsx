import React, {
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Platform,
  Alert,
} from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import {
  isToday,
  isYesterday,
  parseISO,
  format,
  differenceInMinutes,
} from 'date-fns';
import { useTrackingStore, getLiveBuffer } from '../store/trackingStore';
import { useGroupStore } from '../store/groupStore';
import { useThemeStore, useThemedStyles } from '../store/themeStore';
import { trackingService } from '../services/tracking';
import {
  T,
  ACTIVITY_COLORS,
  PLACE_COLORS,
  PLACE_ICONS,
  MAP_STYLE_URL,
  Palette,
} from '../utils/theme';
import { formatDistance, formatDuration, formatTime } from '../utils/geo';
import { catmullRomSpline } from '../utils/catmullRom';
import { Segment } from '../models/types';
import { GroupLivePoint } from '../services/groupLiveLocation';

const HCMC_CENTER: [number, number] = [106.7, 10.777];

// Per-family-member colors so each member's trail + avatar share a hue and none
// of them collide with my own accent-blue live trail.
const MEMBER_COLORS = [
  '#22C55E',
  '#F59E0B',
  '#EC4899',
  '#06B6D4',
  '#A855F7',
  '#F97316',
];

function memberColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) {
    h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return MEMBER_COLORS[h % MEMBER_COLORS.length];
}

// Last-seen timestamp label (the "Last seen" wording is dropped — the
// date/time alone conveys it).
function formatLastSeen(millis: number): string {
  if (!millis) return '';
  const d = new Date(millis);
  const mins = differenceInMinutes(new Date(), d);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`;
  return format(d, 'MMM d, HH:mm');
}

export default function MapScreen() {
  const styles = useThemedStyles(makeStyles);
  const themeMode = useThemeStore(s => s.mode);
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const didFitFamilyRef = useRef(false);
  const [selectedPlace, setSelectedPlace] = useState<Segment | null>(null);

  const isTracking = useTrackingStore(s => s.isTracking);
  const currentPosition = useTrackingStore(s => s.currentPosition);
  const todayLog = useTrackingStore(s => s.todayLog);
  const liveVersion = useTrackingStore(s => s.liveVersion);
  const selectedDate = useTrackingStore(s => s.selectedDate);
  const dateMode = useTrackingStore(s => s.dateMode);

  // Live mode = actively tracking today's timeline; anything else (a past day,
  // month/year aggregates, or tracking off) is "filter" mode. In live mode we
  // only show the live trail (livePoint); finished route polylines are hidden.
  const isLiveMode =
    isTracking && dateMode === 'day' && isToday(parseISO(selectedDate));
  const currentUser = useGroupStore(s => s.currentUser);
  const liveMembers = useGroupStore(s => s.liveMembers);
  const memberTrails = useGroupStore(s => s.memberTrails);

  const trips = useMemo(() => {
    if (!todayLog) return [];
    return todayLog.segments.filter(s => s.type === 'trip');
  }, [todayLog]);

  // Bridge trips that share an activity and have a small temporal gap (< 60s)
  // so brief stop-detector blips don't render as visually disconnected polylines.
  const tripGroups = useMemo(() => {
    const BRIDGE_GAP_MS = 60_000;
    const groups: Segment[][] = [];
    for (const trip of trips) {
      const last = groups[groups.length - 1];
      const tail = last?.[last.length - 1];
      if (
        tail &&
        tail.activity === trip.activity &&
        trip.startTime - tail.endTime <= BRIDGE_GAP_MS
      ) {
        last.push(trip);
      } else {
        groups.push([trip]);
      }
    }
    return groups;
  }, [trips]);

  const uniquePlaces = useMemo(() => {
    if (!todayLog) return [];
    const seen = new Map<string, Segment>();
    todayLog.segments
      .filter(s => s.type === 'visit' && s.place)
      .forEach(s => {
        const key = s.place!.id;
        if (!seen.has(key)) seen.set(key, s);
      });
    return [...seen.values()];
  }, [todayLog]);

  const visibleFamilyMembers = useMemo(
    () =>
      liveMembers.filter(
        member => member.uid !== currentUser?.uid || !isTracking,
      ),
    [currentUser?.uid, isTracking, liveMembers],
  );

  const familyCoordinates = useMemo(() => {
    const coords = visibleFamilyMembers.map(
      member => [member.longitude, member.latitude] as [number, number],
    );
    if (currentPosition) {
      coords.push([currentPosition.longitude, currentPosition.latitude]);
    }
    return coords;
  }, [currentPosition, visibleFamilyMembers]);

  useEffect(() => {
    if (didFitFamilyRef.current || familyCoordinates.length === 0) return;
    didFitFamilyRef.current = true;

    if (familyCoordinates.length === 1) {
      cameraRef.current?.setCamera({
        centerCoordinate: familyCoordinates[0],
        zoomLevel: 14,
        animationDuration: 500,
      });
      return;
    }

    const lngs = familyCoordinates.map(coord => coord[0]);
    const lats = familyCoordinates.map(coord => coord[1]);
    cameraRef.current?.fitBounds(
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.min(...lats)],
      [120, 48, 160, 48],
      700,
    );
  }, [familyCoordinates]);

  // Realtime family trails: recomputed whenever a new snapshot updates
  // `memberTrails` (or the visible set changes), so each Mapbox source updates
  // exactly when fresh data arrives and stays untouched otherwise.
  const memberTrailFeatures = useMemo(
    () =>
      visibleFamilyMembers
        .map(member => ({
          uid: member.uid,
          color: memberColor(member.uid),
          coords: memberTrails[member.uid],
        }))
        .filter(t => t.coords && t.coords.length >= 2),
    [visibleFamilyMembers, memberTrails],
  );

  const liveShape = useMemo(() => {
    const pts = getLiveBuffer();
    if (pts.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: pts.map(p => [p.longitude, p.latitude]),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion]);

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

  const [showSimPanel, setShowSimPanel] = useState(false);

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
        styleURL={MAP_STYLE_URL[themeMode]}
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

        {/* Route polylines — hidden in live mode (only the live trail shows) */}
        {!isLiveMode && tripGroups.map(group => {
          const head = group[0];
          const coords: [number, number][] = [];
          for (const trip of group) {
            const raw = trip.simplifiedPoints || trip.points;
            const segCoords =
              !trip.simplifiedPoints && raw.length >= 3
                ? catmullRomSpline(raw, 8)
                : raw.map(p => [p.longitude, p.latitude] as [number, number]);
            coords.push(...segCoords);
          }
          if (coords.length < 2) return null;
          const color = ACTIVITY_COLORS[head.activity];
          const groupId = group.map(t => t.id).join('-');

          return (
            <MapboxGL.ShapeSource
              key={groupId}
              id={`route-${groupId}`}
              shape={{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: coords,
                },
              }}
            >
              {/* Outer glow */}
              <MapboxGL.LineLayer
                id={`route-glow-${groupId}`}
                style={{
                  lineColor: color,
                  lineWidth: 18,
                  lineOpacity: 0.16,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {/* Inner glow */}
              <MapboxGL.LineLayer
                id={`route-glow2-${groupId}`}
                style={{
                  lineColor: color,
                  lineWidth: 9,
                  lineOpacity: 0.3,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {/* Main line */}
              <MapboxGL.LineLayer
                id={`route-line-${groupId}`}
                style={{
                  lineColor: color,
                  lineWidth: 5,
                  lineOpacity: 1,
                  lineCap: 'round',
                  lineJoin: 'round',
                  ...(head.activity === 'walking'
                    ? { lineDasharray: [2, 1.5] }
                    : head.activity === 'cycling'
                    ? { lineDasharray: [4, 1] }
                    : {}),
                }}
              />
              {/* Bright core highlight */}
              <MapboxGL.LineLayer
                id={`route-core-${groupId}`}
                style={{
                  lineColor: '#FFFFFF',
                  lineWidth: 1.4,
                  lineOpacity: 0.45,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </MapboxGL.ShapeSource>
          );
        })}

        {/* My live in-progress polyline — accent blue, solid (distinct from
            family members' dashed, per-member colored trails) */}
        {isTracking && liveShape && (
          <MapboxGL.ShapeSource id="live-trip" shape={liveShape} lineMetrics>
            <MapboxGL.LineLayer
              id="live-trip-glow"
              style={{
                lineColor: T.accent,
                lineWidth: 14,
                lineOpacity: 0.18,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            {/* Gradient body: fades from cyan at the tail to accent at the head */}
            <MapboxGL.LineLayer
              id="live-trip-line"
              style={{
                lineWidth: 5,
                lineOpacity: 1,
                lineCap: 'round',
                lineJoin: 'round',
                lineGradient: [
                  'interpolate',
                  ['linear'],
                  ['line-progress'],
                  0,
                  '#22D3EE',
                  0.5,
                  '#3B8EF0',
                  1,
                  '#6366F1',
                ],
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

        {/* Family member live trails (reconstructed locally from the stream) */}
        {memberTrailFeatures.map(({ uid, color, coords }) => (
          <MapboxGL.ShapeSource
            key={`member-trail-${uid}`}
            id={`member-trail-${uid}`}
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coords! },
            }}
          >
            <MapboxGL.LineLayer
              id={`member-trail-line-${uid}`}
              style={{
                lineColor: color,
                lineWidth: 4,
                lineOpacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
                lineDasharray: [2, 1.5],
              }}
            />
          </MapboxGL.ShapeSource>
        ))}

        {/* Online family member markers */}
        {visibleFamilyMembers.map(member => (
          <GroupMemberMarker key={member.uid} member={member} />
        ))}

        {/* Current location */}
        {isTracking && currentPosition && (
          <MapboxGL.MarkerView
            id="current-location"
            coordinate={[currentPosition.longitude, currentPosition.latitude]}
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
          {
            v: `${Math.round(useTrackingStore.getState().batteryLevel)}%`,
            l: 'Battery',
          },
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

      {/* Simulation panel */}
      {showSimPanel && (
        <View style={styles.simPanel}>
          {[
            {
              label: 'Walk',
              action: () =>
                trackingService.simulateRoute(
                  [
                    [10.7731, 106.703],
                    [10.7735, 106.6995],
                    [10.775, 106.6975],
                    [10.777, 106.695],
                  ],
                  30000,
                  'walking',
                ),
            },
            {
              label: 'Cycle',
              action: () =>
                trackingService.simulateRoute(
                  [
                    [10.7735, 106.6995],
                    [10.777, 106.695],
                    [10.78, 106.692],
                    [10.7845, 106.687],
                  ],
                  20000,
                  'cycling',
                ),
            },
            {
              label: 'Drive',
              action: () =>
                trackingService.simulateRoute(
                  [
                    [10.7845, 106.687],
                    [10.781, 106.693],
                    [10.777, 106.6985],
                    [10.7731, 106.703],
                  ],
                  15000,
                  'driving',
                ),
            },
            {
              label: 'Stay',
              action: () =>
                trackingService.simulateStay([10.7731, 106.703], 150000),
            },
            { label: 'Stop', action: () => trackingService.stopSimulation() },
            {
              label: 'Re-match',
              action: async () => {
                const date = useTrackingStore.getState().selectedDate;
                const res = await trackingService.rematchTrips(date);
                Alert.alert(
                  'Re-match done',
                  `ok=${res.ok} failed=${res.failed} skipped=${res.skipped}`,
                );
              },
            },
          ].map(s => (
            <TouchableOpacity
              key={s.label}
              style={styles.simBtn}
              onPress={() => {
                s.action();
                setShowSimPanel(false);
              }}
            >
              <Text style={styles.simBtnText}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* FABs */}
      <View style={styles.fabContainer}>
        {__DEV__ && (
          <Pressable
            style={[styles.fabSmall, { backgroundColor: '#7C3AED' }]}
            onLongPress={() => setShowSimPanel(v => !v)}
            delayLongPress={800}
            onPress={() => showSimPanel && setShowSimPanel(false)}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
              SIM
            </Text>
          </Pressable>
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
  const styles = useThemedStyles(makeStyles);
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
        <View
          style={[
            styles.markerOuter,
            { backgroundColor: color + '33', borderColor: color + '55' },
          ]}
        >
          <View
            style={[
              styles.markerInner,
              {
                backgroundColor: color,
                borderColor: isSelected ? '#fff' : '#FFFFFF',
                borderWidth: isSelected ? 3 : 2,
                shadowColor: color,
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

const GroupMemberMarker = React.memo(function GroupMemberMarker({
  member,
}: {
  member: GroupLivePoint;
}) {
  const styles = useThemedStyles(makeStyles);
  const initials = member.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');

  const color = memberColor(member.uid);

  return (
    <MapboxGL.MarkerView
      id={`group-member-${member.uid}`}
      coordinate={[member.longitude, member.latitude]}
    >
      <View style={styles.memberMarkerContainer}>
        <View style={[styles.memberMarkerPulse, { backgroundColor: color + '33' }]}>
          <View style={[styles.memberMarkerAvatar, { backgroundColor: color }]}>
            {member.photoURL ? (
              <Image
                source={{ uri: member.photoURL }}
                style={styles.memberMarkerImage}
              />
            ) : (
              <Text style={styles.memberMarkerInitials}>{initials || 'M'}</Text>
            )}
          </View>
        </View>
        <View style={[styles.memberMarkerLabelWrap, { borderColor: color + '66' }]}>
          <Text style={styles.memberMarkerName} numberOfLines={1}>
            {member.displayName}
          </Text>
          {!member.isOnline && (
            <Text style={styles.memberMarkerStatus} numberOfLines={1}>
              {formatLastSeen(member.updatedAtMillis)}
            </Text>
          )}
        </View>
      </View>
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
  const styles = useThemedStyles(makeStyles);
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
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  map: { flex: 1 },

  // Stats bar
  statsBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 12,
    left: 12,
    right: 12,
    backgroundColor: t.overlay,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  statItem: { alignItems: 'center' },
  statValue: {
    color: t.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: -0.5,
  },
  statLabel: {
    color: t.textSub,
    fontSize: 10,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Markers
  markerContainer: { alignItems: 'center' },
  markerOuter: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.55,
    shadowRadius: 5,
    elevation: 5,
  },
  markerIcon: { fontSize: 12, color: '#fff' },
  markerLabel: {
    color: t.text,
    fontSize: 9.5,
    fontWeight: '700',
    marginTop: 3,
    textAlign: 'center',
    maxWidth: 86,
    backgroundColor: t.overlay,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },

  // Current location dot
  currentDotOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.accent + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentDotInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.accent,
    borderWidth: 2.5,
    borderColor: '#fff',
  },

  // Group member markers
  memberMarkerContainer: {
    alignItems: 'center',
  },
  memberMarkerPulse: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#22C55E33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberMarkerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberMarkerImage: {
    width: 32,
    height: 32,
  },
  memberMarkerInitials: {
    color: '#052E16',
    fontSize: 11,
    fontWeight: '800',
  },
  memberMarkerLabelWrap: {
    maxWidth: 150,
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: t.overlay,
    borderWidth: 1,
    borderColor: '#22C55E66',
  },
  memberMarkerName: {
    color: t.text,
    fontSize: 10,
    fontWeight: '700',
  },
  memberMarkerStatus: {
    color: t.textDim,
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
    textTransform: 'uppercase',
  },

  // Place popup
  popup: {
    position: 'absolute',
    bottom: 80,
    left: 12,
    right: 12,
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
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
  popupTitle: { color: t.text, fontSize: 14, fontWeight: '600' },
  popupAddress: { color: t.textSub, fontSize: 12, marginTop: 2 },
  popupClose: {
    color: t.textDim,
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
    backgroundColor: t.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  popupPillValue: {
    color: t.text,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  popupPillLabel: {
    color: t.textSub,
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
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
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

  // Simulation panel
  simPanel: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 130 : 120,
    right: 12,
    backgroundColor: t.overlay,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    padding: 6,
    gap: 4,
  },
  simBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: t.surface,
  },
  simBtnText: {
    color: t.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
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
    borderColor: t.textSub,
  },
  crosshairLine: {
    position: 'absolute',
    backgroundColor: t.textSub,
  },
  crosshairTop: { top: 0, width: 1.5, height: 4 },
  crosshairBottom: { bottom: 0, width: 1.5, height: 4 },
  crosshairLeft: { left: 0, height: 1.5, width: 4 },
  crosshairRight: { right: 0, height: 1.5, width: 4 },
});
