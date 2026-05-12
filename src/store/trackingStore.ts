import { create } from 'zustand';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from 'date-fns';
import {
  GpsPoint,
  Segment,
  DayLog,
  ActivityType,
  TrackingState,
  PowerProfile,
} from '../models/types';
import { simplifyRoute } from '../utils/routeSimplify';
import { database } from '../services/database';

export type DateMode = 'day' | 'month' | 'year';

export interface LivePoint {
  latitude: number;
  longitude: number;
}

let liveBuffer: LivePoint[] = [];
const LIVE_RENDER_INTERVAL = 3;

export function getLiveBuffer(): LivePoint[] {
  return liveBuffer;
}

interface TrackingStore extends TrackingState {
  dateMode: DateMode;
  setTracking: (isTracking: boolean) => void;
  updatePosition: (point: GpsPoint) => void;
  updateCurrentActivity: (activity: ActivityType) => void;
  addSegment: (segment: Segment) => void;
  setSelectedDate: (date: string, mode?: DateMode) => void;
  loadDayLog: (date: string) => Promise<void>;
  loadDateRange: (date: string, mode: DateMode) => Promise<void>;
  setPowerProfile: (profile: PowerProfile) => void;
  setCharging: (isCharging: boolean) => void;
  dayLogs: Record<string, DayLog>;
  liveVersion: number;
  appendLivePoint: (point: LivePoint) => void;
  clearLivePoints: () => void;
}

const todayKey = () => format(new Date(), 'yyyy-MM-dd');

export const useTrackingStore = create<TrackingStore>((set, get) => ({
  isTracking: false,
  currentPosition: null,
  currentSegment: null,
  todayLog: null,
  selectedDate: todayKey(),
  dateMode: 'day' as DateMode,
  batteryLevel: 100,
  currentPowerProfile: 'balanced',
  isCharging: false,
  dayLogs: {},
  liveVersion: 0,

  appendLivePoint: point => {
    liveBuffer.push(point);
    if (liveBuffer.length % LIVE_RENDER_INTERVAL === 0) {
      set({ liveVersion: liveBuffer.length });
    }
  },

  clearLivePoints: () => {
    liveBuffer = [];
    set({ liveVersion: 0 });
  },

  setTracking: isTracking => set({ isTracking }),
  setPowerProfile: profile => set({ currentPowerProfile: profile }),
  setCharging: isCharging => set({ isCharging }),

  updatePosition: point => {
    set({
      currentPosition: point,
      batteryLevel: point.batteryLevel ?? get().batteryLevel,
    });
  },

  updateCurrentActivity: activity => {
    const current = get().currentSegment;
    if (current) {
      set({ currentSegment: { ...current, activity } });
    }
  },

  addSegment: segment => {
    console.log(`[addSegment] type=${segment.type} pts=${segment.points.length}`);
    const dateKey = format(new Date(segment.startTime), 'yyyy-MM-dd');
    const prevDayLogs = get().dayLogs;
    const prevLog = prevDayLogs[dateKey] ?? createEmptyDayLog(dateKey);

    if (segment.type === 'trip' && !segment.simplifiedPoints && segment.points.length > 2) {
      segment.simplifiedPoints = simplifyRoute(
        segment.points.map(p => ({
          latitude: p.latitude,
          longitude: p.longitude,
        })),
        0.00005,
      );
    }

    const duration = segment.endTime - segment.startTime;
    const breakdown = { ...prevLog.activityBreakdown };
    breakdown[segment.activity] =
      (breakdown[segment.activity] || 0) + duration;

    const nextLog: DayLog = {
      ...prevLog,
      segments: [...prevLog.segments, segment],
      totalDistance:
        prevLog.totalDistance +
        (segment.type === 'trip' ? segment.distance || 0 : 0),
      totalMovingTime:
        prevLog.totalMovingTime + (segment.type === 'trip' ? duration : 0),
      totalStationaryTime:
        prevLog.totalStationaryTime + (segment.type === 'visit' ? duration : 0),
      placesVisited:
        prevLog.placesVisited +
        (segment.type === 'visit' && segment.place ? 1 : 0),
      activityBreakdown: breakdown,
    };

    const nextDayLogs = { ...prevDayLogs, [dateKey]: nextLog };

    if (segment.type === 'trip') {
      liveBuffer = [];
    }

    const updates: Partial<TrackingStore> = {
      dayLogs: nextDayLogs,
      ...(segment.type === 'trip' ? { liveVersion: 0 } : {}),
    };

    // Update todayLog if we're viewing this day or a range that includes it
    const state = get();
    if (state.dateMode === 'day' && dateKey === state.selectedDate) {
      updates.todayLog = nextLog;
    } else if (state.dateMode === 'day' && dateKey === todayKey()) {
      // Live tracking updates the cache but don't switch view
    } else if (state.dateMode !== 'day') {
      // For month/year, re-aggregate would be expensive; just update cache
    }

    set(updates);
    persistSegmentAndDayLog(dateKey, segment, nextLog);
  },

  setSelectedDate: (date, mode) => {
    const m = mode ?? 'day';
    set({ selectedDate: date, dateMode: m });
    if (m === 'day') {
      get().loadDayLog(date);
    } else {
      get().loadDateRange(date, m);
    }
  },

  loadDayLog: async date => {
    const dayLogs = get().dayLogs;

    if (dayLogs[date]) {
      set({ todayLog: dayLogs[date] });
      return;
    }

    try {
      const log = await database.getDayLog(date);
      if (log) {
        set({
          dayLogs: { ...get().dayLogs, [date]: log },
          todayLog: log,
        });
      } else {
        set({ todayLog: createEmptyDayLog(date) });
      }
    } catch (error) {
      console.warn('[Store] Failed to load day log:', error);
    }
  },

  loadDateRange: async (date, mode) => {
    try {
      const d = new Date(date + 'T00:00:00');
      let startDate: string;
      let endDate: string;

      if (mode === 'month') {
        startDate = format(startOfMonth(d), 'yyyy-MM-dd');
        endDate = format(endOfMonth(d), 'yyyy-MM-dd');
      } else {
        startDate = format(startOfYear(d), 'yyyy-MM-dd');
        endDate = format(endOfYear(d), 'yyyy-MM-dd');
      }

      // Cap endDate to today
      const today = todayKey();
      if (endDate > today) endDate = today;

      const logs = await database.getDayLogsInRange(startDate, endDate);
      const aggregated = aggregateDayLogs(logs, date);

      // Cache individual day logs
      const nextDayLogs = { ...get().dayLogs };
      for (const log of logs) {
        nextDayLogs[log.date] = log;
      }

      set({ dayLogs: nextDayLogs, todayLog: aggregated });
    } catch (error) {
      console.warn('[Store] Failed to load date range:', error);
      set({ todayLog: createEmptyDayLog(date) });
    }
  },
}));

function aggregateDayLogs(logs: DayLog[], date: string): DayLog {
  if (logs.length === 0) return createEmptyDayLog(date);

  const allSegments: Segment[] = [];
  let totalDistance = 0;
  let totalMovingTime = 0;
  let totalStationaryTime = 0;
  let placesVisited = 0;
  const breakdown: Record<string, number> = {};

  for (const log of logs) {
    allSegments.push(...log.segments);
    totalDistance += log.totalDistance;
    totalMovingTime += log.totalMovingTime;
    totalStationaryTime += log.totalStationaryTime;
    placesVisited += log.placesVisited;

    for (const [activity, duration] of Object.entries(log.activityBreakdown)) {
      breakdown[activity] = (breakdown[activity] || 0) + duration;
    }
  }

  allSegments.sort((a, b) => a.startTime - b.startTime);

  return {
    date,
    segments: allSegments,
    totalDistance,
    totalMovingTime,
    totalStationaryTime,
    placesVisited,
    activityBreakdown: breakdown as Record<ActivityType, number>,
  };
}

function createEmptyDayLog(date: string): DayLog {
  return {
    date,
    segments: [],
    totalDistance: 0,
    totalMovingTime: 0,
    totalStationaryTime: 0,
    placesVisited: 0,
    activityBreakdown: {} as Record<ActivityType, number>,
  };
}

async function persistSegmentAndDayLog(
  dateKey: string,
  segment: Segment,
  dayLog: DayLog,
): Promise<void> {
  try {
    await database.insertSegment(segment, dateKey);
    await database.upsertDayLog(dayLog);
    console.log(`[persist] OK type=${segment.type} pts=${segment.points.length}`);
  } catch (error) {
    console.warn('[persist] FAIL:', JSON.stringify(error), (error as any)?.message);
  }
}
