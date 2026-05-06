import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  startActivityUpdates(intervalMs: number): Promise<void>;
  stopActivityUpdates(): Promise<void>;
  queryActivities(startMs: number, endMs: number): Promise<Object[]>;
  isAvailable(): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ActivityRecognition');
