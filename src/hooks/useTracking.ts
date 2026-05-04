import { useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus, Alert } from 'react-native';
import { trackingService } from '../services/tracking';
import { useTrackingStore } from '../store/trackingStore';

export function useTracking() {
  const appState = useRef(AppState.currentState);
  const { isTracking } = useTrackingStore();

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          const today = new Date().toISOString().split('T')[0];
          useTrackingStore.getState().loadDayLog(today);
        }
        appState.current = nextState;
      },
    );

    return () => subscription.remove();
  }, []);

  const startTracking = useCallback(async () => {
    try {
      await trackingService.start();
    } catch (error: any) {
      if (error?.code === 0) {
        Alert.alert(
          'Location Permission Required',
          'Life Map needs "Always" location access to track your movements in the background. Please enable it in Settings.',
          [{ text: 'OK' }],
        );
      } else {
        console.error('[useTracking] Start failed:', error);
      }
    }
  }, []);

  const stopTracking = useCallback(async () => {
    await trackingService.stop();
  }, []);

  const toggleTracking = useCallback(async () => {
    if (isTracking) {
      await stopTracking();
    } else {
      await startTracking();
    }
  }, [isTracking, startTracking, stopTracking]);

  return { isTracking, startTracking, stopTracking, toggleTracking };
}
