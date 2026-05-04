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
    const dateKey = format(new Date(segment.startTime), 'yyyy-MM-dd');
    const dayLogs = { ...get().dayLogs };

    if (segment.type === 'trip' && segment.points.length > 2) {
      segment.simplifiedPoints = simplifyRoute(
        segment.points.map(p => ({
          latitude: p.latitude,
          longitude: p.longitude,
        })),
        0.00005,
      );
    }

    if (!dayLogs[dateKey]) {
      dayLogs[dateKey] = createEmptyDayLog(dateKey);
    }

    const dayLog = dayLogs[dateKey];
    dayLog.segments.push(segment);

    const duration = segment.endTime - segment.startTime;
    if (segment.type === 'trip') {
      dayLog.totalDistance += segment.distance || 0;
      dayLog.totalMovingTime += duration;
    } else {
      dayLog.totalStationaryTime += duration;
      if (segment.place) dayLog.placesVisited += 1;
    }
    dayLog.activityBreakdown[segment.activity] =
      (dayLog.activityBreakdown[segment.activity] || 0) + duration;

    set({ dayLogs });

    if (dateKey === todayKey()) {
      set({ todayLog: dayLog });
    }

    persistSegmentAndDayLog(dateKey, segment, dayLog);
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
  } catch (error) {
    console.warn('[Store] Failed to persist:', error);
  }
}
