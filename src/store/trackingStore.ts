import { create } from 'zustand';
import { format } from 'date-fns';
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

interface LivePoint {
  latitude: number;
  longitude: number;
}

interface TrackingStore extends TrackingState {
  setTracking: (isTracking: boolean) => void;
  updatePosition: (point: GpsPoint) => void;
  updateCurrentActivity: (activity: ActivityType) => void;
  addSegment: (segment: Segment) => void;
  setSelectedDate: (date: string) => void;
  loadDayLog: (date: string) => Promise<void>;
  setPowerProfile: (profile: PowerProfile) => void;
  setCharging: (isCharging: boolean) => void;
  dayLogs: Record<string, DayLog>;
  livePoints: LivePoint[];
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
  batteryLevel: 100,
  currentPowerProfile: 'balanced',
  isCharging: false,
  dayLogs: {},
  livePoints: [],

  appendLivePoint: point =>
    set(state => ({ livePoints: [...state.livePoints, point] })),

  clearLivePoints: () => set({ livePoints: [] }),

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

    if (segment.type === 'trip' && segment.points.length > 2) {
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

    set({
      dayLogs: nextDayLogs,
      ...(dateKey === todayKey() ? { todayLog: nextLog } : {}),
      ...(segment.type === 'trip' ? { livePoints: [] } : {}),
    });

    persistSegmentAndDayLog(dateKey, segment, nextLog);
  },

  setSelectedDate: date => {
    set({ selectedDate: date });
    get().loadDayLog(date);
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
}));

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
