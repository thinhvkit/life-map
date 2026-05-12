import React, { useEffect, useState } from 'react';
import { StatusBar, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MapboxGL from '@rnmapbox/maps';

import MapScreen from '../screens/MapScreen';
import TimelineScreen from '../screens/TimelineScreen';
import StatsScreen from '../screens/StatsScreen';
import { IconMap, IconTimeline, IconStats } from '../components/TabIcons';
import DateHeader from '../components/DateHeader';
import { trackingService } from '../services/tracking';
import { useTrackingStore, getLiveBuffer } from '../store/trackingStore';
import { database } from '../services/database';
import { generateMockDayLog } from '../services/mockData';
import { MAPBOX_ACCESS_TOKEN } from '../config.local';
import { T } from '../utils/theme';

const Tab = createBottomTabNavigator();

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);
      } catch (e) {
        console.warn('[App] Mapbox token error:', e);
      }

      database.init();
      try {
        await trackingService.configure();
        const store = useTrackingStore.getState();
        if (store.isTracking) {
          await trackingService.start();
        }
      } catch (e) {
        console.warn('[App] Init error:', e);
      }

      const today = new Date().toISOString().split('T')[0];
      await useTrackingStore.getState().loadDayLog(today);

      if (__DEV__) {
        const mockLog = generateMockDayLog();
        useTrackingStore.setState((state) => ({
          dayLogs: { ...state.dayLogs, [mockLog.date]: mockLog },
        }));

        // Expose simulation helper on global for dev console
        (global as any).sim = {
          walk: () => trackingService.simulateRoute(
            [[10.7731, 106.7030], [10.7735, 106.6995], [10.7750, 106.6975], [10.7770, 106.6950]],
            30000, 'walking',
          ),
          cycle: () => trackingService.simulateRoute(
            [[10.7735, 106.6995], [10.7770, 106.6950], [10.7800, 106.6920], [10.7845, 106.6870]],
            20000, 'cycling',
          ),
          drive: () => trackingService.simulateRoute(
            [[10.7845, 106.6870], [10.7810, 106.6930], [10.7770, 106.6985], [10.7731, 106.7030]],
            15000, 'driving',
          ),
          stop: () => trackingService.stopSimulation(),
          // Stay stationary at a coord for N seconds (default 150s = qualifies as place)
          stay: (coord: [number, number] = [10.7731, 106.7030], seconds = 150) =>
            trackingService.simulateStay(coord, seconds * 1000),
          clearToday: async () => {
            const today = new Date().toISOString().split('T')[0];
            const n = await database.clearDate(today);
            const store = useTrackingStore.getState();
            const next = { ...store.dayLogs };
            delete next[today];
            getLiveBuffer().length = 0;
            useTrackingStore.setState({
              dayLogs: next,
              todayLog: null,
              liveVersion: 0,
            });
            await store.loadDayLog(today);
            console.log(`[Sim] Cleared today (${n} segments)`);
          },
        };
      }

      setReady(true);
    }

    init();
  }, []);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <DateHeader />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#060D1C',
            borderTopWidth: 0,
            paddingBottom: 14,
            paddingTop: 10,
            height: 92,
          },
          tabBarActiveTintColor: '#E8EFF8',
          tabBarInactiveTintColor: '#3D5470',
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.4,
            marginTop: 2,
          },
        }}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            tabBarLabel: 'Map',
            tabBarIcon: ({ color, focused }) => (
              <IconMap color={color} active={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Timeline"
          component={TimelineScreen}
          options={{
            tabBarLabel: 'Timeline',
            tabBarIcon: ({ color, focused }) => (
              <IconTimeline color={color} active={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Stats"
          component={StatsScreen}
          options={{
            tabBarLabel: 'Stats',
            tabBarIcon: ({ color, focused }) => (
              <IconStats color={color} active={focused} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: T.bg,
  },
});
