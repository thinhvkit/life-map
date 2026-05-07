import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { format, subDays, addDays, isToday, parseISO } from 'date-fns';
import { useTrackingStore } from '../store/trackingStore';
import { Segment } from '../models/types';
import { T, ACTIVITY_COLORS, PLACE_COLORS } from '../utils/theme';
import { formatDistance, formatDuration, formatTime } from '../utils/geo';

export default function TimelineScreen() {
  const todayLog = useTrackingStore(s => s.todayLog);
  const selectedDate = useTrackingStore(s => s.selectedDate);
  const setSelectedDate = useTrackingStore(s => s.setSelectedDate);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (__DEV__) {
    console.log(
      `[Timeline] render date=${selectedDate} segs=${todayLog?.segments.length ?? 0}`,
    );
  }

  const dateLabel = useMemo(() => {
    if (isToday(parseISO(selectedDate))) return 'Today';
    return format(parseISO(selectedDate), 'EEE, MMM d');
  }, [selectedDate]);

  const handlePrevDay = useCallback(() => {
    const prev = format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd');
    setSelectedDate(prev);
  }, [selectedDate, setSelectedDate]);

  const handleNextDay = useCallback(() => {
    if (!isToday(parseISO(selectedDate))) {
      const next = format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd');
      setSelectedDate(next);
    }
  }, [selectedDate, setSelectedDate]);

  const stats = useMemo(() => {
    if (!todayLog) return { dist: 0, places: 0, moving: 0 };
    return {
      dist: todayLog.totalDistance,
      places: todayLog.placesVisited,
      moving: todayLog.totalMovingTime,
    };
  }, [todayLog]);

  const segments = todayLog?.segments || [];
  const isCurrentDay = isToday(parseISO(selectedDate));

  const renderSegment = useCallback(
    ({ item }: { item: Segment }) => (
      <SegmentCard
        seg={item}
        isExpanded={expanded === item.id}
        onToggle={() =>
          setExpanded(expanded === item.id ? null : item.id)
        }
      />
    ),
    [expanded],
  );

  return (
    <View style={styles.container}>
      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={handlePrevDay} style={styles.dateArrow}>
          <Text style={styles.arrowText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.dateCenter}>
          <Text style={styles.dateText}>{dateLabel}</Text>
          <Text style={styles.dateSummary}>
            {formatDistance(stats.dist)} · {stats.places} places
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleNextDay}
          style={[styles.dateArrow, isCurrentDay && styles.disabled]}
          disabled={isCurrentDay}
        >
          <Text
            style={[
              styles.arrowText,
              isCurrentDay && { color: T.textDim },
            ]}
          >
            ›
          </Text>
        </TouchableOpacity>
      </View>

      {/* Summary chips */}
      {stats.dist > 0 && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryValue}>{formatDistance(stats.dist)}</Text>
            <Text style={styles.summaryLabel}>Distance</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryValue}>{formatDuration(stats.moving)}</Text>
            <Text style={styles.summaryLabel}>Moving</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryValue}>{stats.places}</Text>
            <Text style={styles.summaryLabel}>Places</Text>
          </View>
        </View>
      )}

      {/* Mini time bar */}
      <TimeBar segments={segments} />

      {/* Segments list */}
      {segments.length > 0 ? (
        <FlatList
          data={segments}
          renderItem={renderSegment}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<EndOfDayMarker />}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No activity recorded</Text>
          <Text style={styles.emptySubtext}>
            Start tracking to see your daily timeline
          </Text>
        </View>
      )}
    </View>
  );
}

function TimeBar({ segments }: { segments: Segment[] }) {
  const total = 24 * 60;
  const toPos = (ts: number) => {
    const d = new Date(ts);
    return ((d.getHours() * 60 + d.getMinutes()) / total) * 100;
  };

  const nowPos = (() => {
    const now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) / total) * 100;
  })();

  return (
    <View style={styles.timeBarContainer}>
      <View style={styles.timeBarTrack}>
        {segments.map(seg => {
          const left = toPos(seg.startTime);
          const right = toPos(seg.endTime);
          const width = right - left;
          const col =
            seg.type === 'visit'
              ? PLACE_COLORS[seg.place?.category || 'other']
              : ACTIVITY_COLORS[seg.activity];
          return (
            <View
              key={seg.id}
              style={[
                styles.timeBarSeg,
                {
                  left: `${left}%` as any,
                  width: `${Math.max(width, 0.5)}%` as any,
                  backgroundColor: col,
                  opacity: seg.type === 'trip' ? 0.7 : 0.9,
                },
              ]}
            />
          );
        })}
        <View style={[styles.timeBarNow, { left: `${nowPos}%` as any }]} />
      </View>
      <View style={styles.timeBarLabels}>
        {['12am', '6am', '12pm', '6pm', 'Now'].map(l => (
          <Text key={l} style={styles.timeBarLabel}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function SegmentCard({
  seg,
  isExpanded,
  onToggle,
}: {
  seg: Segment;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isTrip = seg.type === 'trip';
  const dur = seg.endTime - seg.startTime;
  const col = isTrip
    ? ACTIVITY_COLORS[seg.activity]
    : PLACE_COLORS[seg.place?.category || 'other'];
  const label = isTrip
    ? seg.activity.charAt(0).toUpperCase() + seg.activity.slice(1)
    : seg.place?.name || 'Unknown';

  return (
    <View style={styles.segmentRow}>
      {/* Time + vertical line column */}
      <View style={styles.timeCol}>
        <Text style={styles.timeText}>{formatTime(seg.startTime)}</Text>
        <View
          style={[
            styles.timeLine,
            {
              backgroundColor: col,
              minHeight: isTrip ? 10 : 20,
            },
          ]}
        />
        {isExpanded && (
          <Text style={styles.timeTextEnd}>{formatTime(seg.endTime)}</Text>
        )}
      </View>

      {/* Card */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onToggle}
        style={[
          styles.card,
          {
            backgroundColor: isExpanded ? T.card : T.surface,
            borderLeftColor: col,
            borderLeftWidth: 2.5,
            opacity: isTrip ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.cardRow}>
          {/* Dot / diamond indicator */}
          <View
            style={[
              styles.dot,
              {
                width: isTrip ? 8 : 10,
                height: isTrip ? 8 : 10,
                borderRadius: isTrip ? 2 : 5,
                backgroundColor: col,
                transform: isTrip ? [{ rotate: '45deg' }] : [],
              },
            ]}
          />
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <Text
                style={[
                  styles.cardTitle,
                  {
                    color: isTrip ? T.textSub : T.text,
                    fontSize: isTrip ? 12 : 14,
                    fontWeight: isTrip ? '400' : '600',
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text style={styles.cardDuration}>{formatDuration(dur)}</Text>
            </View>
            {!isTrip && seg.place?.address && (
              <Text style={styles.cardAddress} numberOfLines={1}>
                {seg.place.address}
              </Text>
            )}
            {isTrip && (
              <Text style={styles.cardTripInfo}>
                {seg.activity} · {formatDistance(seg.distance || 0)}
              </Text>
            )}
          </View>
        </View>

        {/* Expanded detail */}
        {isExpanded && (
          <View style={styles.expandedContainer}>
            <View style={styles.pillRow}>
              {isTrip ? (
                <>
                  <MetaPill label="From" value={formatTime(seg.startTime)} col={col} />
                  <MetaPill label="To" value={formatTime(seg.endTime)} col={col} />
                  <MetaPill
                    label="Dist"
                    value={formatDistance(seg.distance || 0)}
                    col={col}
                  />
                  <MetaPill label="Mode" value={seg.activity} col={col} />
                </>
              ) : (
                <>
                  <MetaPill label="Arrived" value={formatTime(seg.startTime)} col={col} />
                  <MetaPill label="Left" value={formatTime(seg.endTime)} col={col} />
                  <MetaPill label="Stayed" value={formatDuration(dur)} col={col} />
                </>
              )}
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function MetaPill({
  label,
  value,
  col,
}: {
  label: string;
  value: string;
  col: string;
}) {
  return (
    <View style={[styles.pill, { borderColor: col + '22' }]}>
      <Text style={styles.pillValue}>{value}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

function EndOfDayMarker() {
  return (
    <View style={styles.endOfDay}>
      <View style={styles.endOfDayLine} />
      <Text style={styles.endOfDayText}>23:59</Text>
      <View style={styles.endOfDayLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
  },

  // Date nav
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 60 : 14,
    paddingBottom: 12,
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  dateArrow: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: {
    color: T.textSub,
    fontSize: 18,
    fontWeight: '600',
  },
  dateCenter: { alignItems: 'center' },
  dateText: { color: T.text, fontSize: 16, fontWeight: '600' },
  dateSummary: {
    color: T.textSub,
    fontSize: 12,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  disabled: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },

  // Summary chips
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  summaryChip: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 8,
    alignItems: 'center',
  },
  summaryValue: {
    color: T.text,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: -0.3,
  },
  summaryLabel: {
    color: T.textSub,
    fontSize: 9,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Time bar
  timeBarContainer: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  timeBarTrack: {
    position: 'relative',
    height: 18,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: T.muted,
  },
  timeBarSeg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  timeBarNow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#fff',
    borderRadius: 1,
  },
  timeBarLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  timeBarLabel: {
    color: T.textDim,
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Segments list
  listContent: {
    padding: 14,
    paddingBottom: 16,
  },

  segmentRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },

  // Time column
  timeCol: {
    width: 42,
    alignItems: 'center',
    flexShrink: 0,
  },
  timeText: {
    color: T.textSub,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 12,
  },
  timeLine: {
    width: 2,
    flex: 1,
    marginVertical: 4,
    borderRadius: 1,
  },
  timeTextEnd: {
    color: T.textDim,
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 11,
  },

  // Card
  card: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 13,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {},
  cardContent: { flex: 1 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  cardTitle: {},
  cardDuration: {
    color: T.textDim,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardAddress: {
    color: T.textSub,
    fontSize: 11,
    marginTop: 2,
  },
  cardTripInfo: {
    color: T.textDim,
    fontSize: 11,
    marginTop: 1,
  },

  // Expanded
  expandedContainer: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    flex: 1,
    backgroundColor: T.muted,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
  },
  pillValue: {
    color: T.text,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  pillLabel: {
    color: T.textSub,
    fontSize: 9,
    marginTop: 1,
  },

  // End of day
  endOfDay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  endOfDayLine: {
    flex: 1,
    height: 1,
    backgroundColor: T.border,
  },
  endOfDayText: {
    color: T.textDim,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },
  emptyText: { color: T.text, fontSize: 18, fontWeight: '600' },
  emptySubtext: { color: T.textDim, fontSize: 14, marginTop: 4 },
});
