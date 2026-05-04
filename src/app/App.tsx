import React, { useEffect } from 'react';
import { StatusBar, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import MapScreen from '../screens/MapScreen';
import TimelineScreen from '../screens/TimelineScreen';
import StatsScreen from '../screens/StatsScreen';
import { IconMap, IconTimeline, IconStats } from '../components/TabIcons';
import { trackingService } from '../services/tracking';
import { useTrackingStore } from '../store/trackingStore';
import { T } from '../utils/theme';

const Tab = createBottomTabNavigator();

export default function App() {
  useEffect(() => {
    async function init() {
      await trackingService.configure();

      const store = useTrackingStore.getState();
      if (store.isTracking) {
        await trackingService.start();
      }

      const today = new Date().toISOString().split('T')[0];
      await store.loadDayLog(today);
    }

    init();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: T.surface,
            borderTopColor: T.border,
            borderTopWidth: 1,
            paddingBottom: 20,
            paddingTop: 10,
            height: 70,
          },
          tabBarActiveTintColor: T.accent,
          tabBarInactiveTintColor: T.textDim,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.3,
            marginTop: 4,
          },
        }}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            tabBarLabel: 'Map',
            tabBarIcon: ({ color, focused }) => (
              <View style={styles.tabIconWrap}>
                <IconMap color={color} active={focused} />
                {focused && (
                  <View
                    style={[styles.activeDot, { backgroundColor: T.accent }]}
                  />
                )}
              </View>
            ),
          }}
        />
        <Tab.Screen
          name="Timeline"
          component={TimelineScreen}
          options={{
            tabBarLabel: 'Timeline',
            tabBarIcon: ({ color, focused }) => (
              <View style={styles.tabIconWrap}>
                <IconTimeline color={color} active={focused} />
                {focused && (
                  <View
                    style={[styles.activeDot, { backgroundColor: T.accent }]}
                  />
                )}
              </View>
            ),
          }}
        />
        <Tab.Screen
          name="Stats"
          component={StatsScreen}
          options={{
            tabBarLabel: 'Stats',
            tabBarIcon: ({ color, focused }) => (
              <View style={styles.tabIconWrap}>
                <IconStats color={color} active={focused} />
                {focused && (
                  <View
                    style={[styles.activeDot, { backgroundColor: T.accent }]}
                  />
                )}
              </View>
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },
});
