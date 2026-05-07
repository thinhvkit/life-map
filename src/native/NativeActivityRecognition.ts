import type { TurboModule } from 'react-native';
import type { CodegenTypes } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type NativeActivityChangeEvent = {
  activity: string;
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
};

export interface Spec extends TurboModule {
  startActivityUpdates(intervalMs: number): Promise<void>;
  stopActivityUpdates(): Promise<void>;
  queryActivities(startMs: number, endMs: number): Promise<Object[]>;
  isAvailable(): Promise<boolean>;
  readonly onActivityChange: CodegenTypes.EventEmitter<NativeActivityChangeEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ActivityRecognition');
