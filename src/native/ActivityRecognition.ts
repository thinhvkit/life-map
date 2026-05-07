import NativeActivityRecognition from './NativeActivityRecognition';
import type { EventSubscription } from 'react-native';

export type NativeActivityType =
  | 'stationary'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'automotive'
  | 'unknown';

export interface NativeActivityEvent {
  activity: NativeActivityType;
  confidence: number;
  timestamp: number;
  raw?: {
    stationary: boolean;
    walking: boolean;
    running: boolean;
    cycling: boolean;
    automotive: boolean;
    unknown: boolean;
  };
}

type ActivityCallback = (event: NativeActivityEvent) => void;

class ActivityRecognition {
  private subscription: EventSubscription | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      return await NativeActivityRecognition.isAvailable();
    } catch {
      return false;
    }
  }

  async start(
    callback: ActivityCallback,
    intervalMs: number = 3000
  ): Promise<void> {
    this.subscription = NativeActivityRecognition.onActivityChange((event) => {
      callback(event as NativeActivityEvent);
    });
    await NativeActivityRecognition.startActivityUpdates(intervalMs);
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    await NativeActivityRecognition.stopActivityUpdates();
  }

  async queryHistory(
    startMs: number,
    endMs: number
  ): Promise<NativeActivityEvent[]> {
    return NativeActivityRecognition.queryActivities(startMs, endMs) as Promise<NativeActivityEvent[]>;
  }
}

export const activityRecognition = new ActivityRecognition();
