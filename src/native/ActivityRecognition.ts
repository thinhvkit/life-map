import { NativeEventEmitter } from 'react-native';
import NativeActivityRecognition from './NativeActivityRecognition';

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
  private emitter: NativeEventEmitter;
  private subscription: any = null;

  constructor() {
    this.emitter = new NativeEventEmitter(NativeActivityRecognition);
  }

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
    this.subscription = this.emitter.addListener(
      'onActivityChange',
      (event: NativeActivityEvent) => {
        callback(event);
      }
    );
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
