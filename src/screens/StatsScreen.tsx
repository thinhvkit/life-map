import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useTrackingStore } from '../store/trackingStore';
import { ActivityType } from '../models/types';
import { T, ACTIVITY_COLORS } from '../utils/theme';
import { formatDistance, formatDuration } from '../utils/geo';
import { format, parseISO } from 'date-fns';

export default function StatsScreen() {
  const { todayLog, isTracking, batteryLevel, dateMode, selectedDate } = useTrackingStore();

  const headerTitle = useMemo(() => {
    if (dateMode === 'year') return `${format(parseISO(selectedDate), 'yyyy')} Stats`;
    if (dateMode === 'month') return `${format(parseISO(selectedDate), 'MMMM yyyy')} Stats`;
    return "Today's Stats";
  }, [dateMode, selectedDate]);

  const stats = useMemo(() => {
    if (!todayLog || todayLog.segments.length === 0) return null;

    const totalTime = Object.values(todayLog.activityBreakdown).reduce(
      (a, b) => a + b,
      0,
    );

    const activities = (
      Object.entries(todayLog.activityBreakdown) as [ActivityType, number][]
    )
      .filter(([, ms]) => ms > 0)
      .sort(([, a], [, b]) => b - a);

    const trips = todayLog.segments.filter(s => s.type === 'trip');
    const visits = todayLog.segments.filter(s => s.type === 'visit');

    return { totalTime, activities, trips, visits };
  }, [todayLog]);

  // Weekly sparkline mock data
  const weekDist = useMemo(() => {
    const base = [12.4, 8.1, 15.2, 6.8, 11.9, 9.3];
    base.push(todayLog ? todayLog.totalDistance / 1000 : 0);
    return base;
  }, [todayLog]);

  const maxW = Math.max(...weekDist);
  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  if (!stats) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No stats yet</Text>
          <Text style={styles.emptySubtext}>
            Activity data will appear here once you start tracking
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          {dateMode === 'day' && (
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isTracking ? '#16A34A' : '#DC2626',
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {isTracking ? 'Tracking active' : 'Tracking paused'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.batteryInfo}>
          <Text style={styles.batteryLabel}>Battery used</Text>
          <Text style={styles.batteryValue}>~4%</Text>
        </View>
      </View>

      {/* Summary cards */}
      <View style={styles.summaryRow}>
        {[
          {
            l: 'Distance',
            v: formatDistance(todayLog!.totalDistance),
            col: '#3B8EF0',
          },
          {
            l: 'Moving',
            v: formatDuration(todayLog!.totalMovingTime),
            col: '#10B981',
          },
          {
            l: 'Places',
            v: `${todayLog!.placesVisited}`,
            col: '#F59E0B',
          },
        ].map(c => (
          <View key={c.l} style={styles.summaryCard}>
            <Text style={[styles.summaryValue, { color: c.col }]}>
              {c.v}
            </Text>
            <Text style={styles.summaryLabel}>{c.l}</Text>
          </View>
        ))}
      </View>

      {/* Activity breakdown */}
      <SectionLabel>Activity Breakdown</SectionLabel>
      <View style={styles.breakdownContainer}>
        {stats.activities.map(([activity, ms], i) => {
          const pct = (ms / stats.totalTime) * 100;
          const col = ACTIVITY_COLORS[activity];
          return (
            <View key={activity} style={styles.activityRow}>
              <View
                style={[
                  styles.activityIcon,
                  {
                    backgroundColor: col + '22',
                    borderColor: col + '44',
                  },
                ]}
              >
                <View
                  style={[
                    styles.activityDot,
                    {
                      backgroundColor: col,
                      borderRadius: activity === 'driving' ? 2 : 4,
                    },
                  ]}
                />
              </View>
              <View style={styles.activityInfo}>
                <View style={styles.activityHeader}>
                  <Text style={styles.activityName}>
                    {activity.charAt(0).toUpperCase() + activity.slice(1)}
                  </Text>
                  <View style={styles.activityMeta}>
                    <Text style={styles.activityDuration}>
                      {formatDuration(ms)}
                    </Text>
                    <Text style={styles.activityPct}>
                      {pct.toFixed(0)}%
                    </Text>
                  </View>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.max(pct, 1.5)}%` as any,
                        backgroundColor: col,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* Weekly distance sparkline — only for day view */}
      {dateMode === 'day' && (
        <>
          <SectionLabel>This Week</SectionLabel>
          <View style={styles.weekCard}>
            <View style={styles.weekBars}>
              {weekDist.map((d, i) => {
                const h = maxW > 0 ? (d / maxW) * 100 : 0;
                const isToday = i === 6;
                return (
                  <View key={i} style={styles.weekBarCol}>
                    <Text
                      style={[
                        styles.weekBarValue,
                        { color: isToday ? T.accent : T.textDim },
                        isToday && { fontWeight: '700' },
                      ]}
                    >
                      {d.toFixed(1)}
                    </Text>
                    <View
                      style={[
                        styles.weekBar,
                        {
                          height: `${h}%` as any,
                          backgroundColor: isToday ? T.accent : T.muted,
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
            <View style={styles.weekDays}>
              {weekDays.map((d, i) => (
                <Text
                  key={i}
                  style={[
                    styles.weekDayLabel,
                    {
                      color: i === 6 ? T.accent : T.textDim,
                      fontWeight: i === 6 ? '700' : '400',
                    },
                  ]}
                >
                  {d}
                </Text>
              ))}
            </View>
          </View>
        </>
      )}

      {/* Segment counts */}
      <SectionLabel>Segments</SectionLabel>
      <View style={styles.segmentCards}>
        {[
          { l: 'Trips', v: stats.trips.length, col: '#8B5CF6' },
          { l: 'Visits', v: stats.visits.length, col: '#10B981' },
          {
            l: 'Total',
            v: todayLog!.segments.length,
            col: T.textSub,
          },
        ].map((s, i) => (
          <View
            key={s.l}
            style={[
              styles.segmentCard,
              i < 2 && styles.segmentCardBorder,
            ]}
          >
            <Text style={[styles.segmentValue, { color: s.col }]}>
              {s.v}
            </Text>
            <Text style={styles.segmentLabel}>{s.l}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  scrollContent: { paddingBottom: 100 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 16,
    marginBottom: 16,
  },
  headerTitle: {
    color: T.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    color: T.textSub,
    fontSize: 12,
  },
  batteryInfo: { alignItems: 'flex-end' },
  batteryLabel: { color: T.textDim, fontSize: 10 },
  batteryValue: {
    color: '#16A34A',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Summary cards
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.border,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: -1,
  },
  summaryLabel: {
    color: T.textDim,
    fontSize: 10,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Section label
  sectionLabel: {
    color: T.textSub,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
    paddingHorizontal: 16,
  },

  // Activity breakdown
  breakdownContainer: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  activityDot: {
    width: 8,
    height: 8,
  },
  activityInfo: { flex: 1 },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  activityName: {
    color: T.text,
    fontSize: 13,
    fontWeight: '500',
  },
  activityMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  activityDuration: {
    color: T.textSub,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  activityPct: {
    color: T.textDim,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    width: 30,
    textAlign: 'right',
  },
  barTrack: {
    height: 5,
    backgroundColor: T.muted,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 5,
    borderRadius: 3,
  },

  // Weekly sparkline
  weekCard: {
    marginHorizontal: 16,
    backgroundColor: T.card,
    borderRadius: 14,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: T.border,
    marginBottom: 20,
  },
  weekBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 56,
  },
  weekBarCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    height: '100%',
    justifyContent: 'flex-end',
  },
  weekBarValue: {
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  weekBar: {
    width: '100%',
    borderRadius: 4,
    minHeight: 4,
  },
  weekDays: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 6,
  },
  weekDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 9,
  },

  // Segment counts
  segmentCards: {
    marginHorizontal: 16,
    backgroundColor: T.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.border,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segmentCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  segmentCardBorder: {
    borderRightWidth: 1,
    borderRightColor: T.border,
  },
  segmentValue: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  segmentLabel: {
    color: T.textDim,
    fontSize: 11,
    marginTop: 3,
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
