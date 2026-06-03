import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StatusBar,
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import MapboxGL from '@rnmapbox/maps';

import MapScreen from '../screens/MapScreen';
import TimelineScreen from '../screens/TimelineScreen';
import StatsScreen from '../screens/StatsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import {
  IconMap,
  IconTimeline,
  IconStats,
  IconSettings,
} from '../components/TabIcons';
import DateHeader from '../components/DateHeader';
import { trackingService } from '../services/tracking';
import { useTrackingStore, getLiveBuffer } from '../store/trackingStore';
import { useGroupStore } from '../store/groupStore';
import { database } from '../services/database';
import { generateMockDayLog } from '../services/mockData';
import { MAPBOX_ACCESS_TOKEN } from '../config.local';
import { T, Palette } from '../utils/theme';
import {
  useThemeStore,
  useThemedStyles,
  useThemePalette,
  hydrateThemeMode,
} from '../store/themeStore';

const Tab = createBottomTabNavigator();

export default function App() {
  const styles = useThemedStyles(makeStyles);
  const themeMode = useThemeStore(s => s.mode);
  const barStyle = themeMode === 'light' ? 'dark-content' : 'light-content';
  const [ready, setReady] = useState(false);
  const authLoading = useGroupStore(s => s.authLoading);
  const currentUser = useGroupStore(s => s.currentUser);

  useEffect(() => {
    const disposeGroupStore = useGroupStore.getState().init();

    async function init() {
      try {
        MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);
      } catch (e) {
        console.warn('[App] Mapbox token error:', e);
      }

      database.init();
      hydrateThemeMode(); // re-apply persisted theme now the DB is ready
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
        useTrackingStore.setState(state => ({
          dayLogs: { ...state.dayLogs, [mockLog.date]: mockLog },
        }));

        // Expose simulation helper on global for dev console
        (globalThis as any).sim = {
          walk: () =>
            trackingService.simulateRoute(
              [
                [10.7731, 106.703],
                [10.7735, 106.6995],
                [10.775, 106.6975],
                [10.777, 106.695],
              ],
              30000,
              'walking',
            ),
          cycle: () =>
            trackingService.simulateRoute(
              [
                [10.7735, 106.6995],
                [10.777, 106.695],
                [10.78, 106.692],
                [10.7845, 106.687],
              ],
              20000,
              'cycling',
            ),
          drive: () =>
            trackingService.simulateRoute(
              [
                [10.7845, 106.687],
                [10.781, 106.693],
                [10.777, 106.6985],
                [10.7731, 106.703],
              ],
              15000,
              'driving',
            ),
          stop: () => trackingService.stopSimulation(),
          // Stay stationary at a coord for N seconds (default 150s = qualifies as place)
          stay: (coord: [number, number] = [10.7731, 106.703], seconds = 150) =>
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

    return disposeGroupStore;
  }, []);

  if (!ready || authLoading) {
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <StatusBar
            barStyle={barStyle}
            backgroundColor="transparent"
            translucent
          />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!currentUser) {
    return (
      <SafeAreaProvider>
        <StatusBar
          barStyle={barStyle}
          backgroundColor="transparent"
          translucent
        />
        <SignInScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={barStyle}
        backgroundColor="transparent"
        translucent
      />
      <NavigationContainer>
        <DateHeader />
        <TabBar />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

function SignInScreen() {
  const styles = useThemedStyles(makeStyles);
  const error = useGroupStore(s => s.error);
  const signInWithGoogle = useGroupStore(s => s.signInWithGoogle);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.signInScreen}>
      <View style={styles.signInPanel}>
        <Text style={styles.signInTitle}>Life Map</Text>
        <Text style={styles.signInSubtitle}>
          Sign in to share live location with your family group.
        </Text>
        <TouchableOpacity
          style={[styles.googleButton, busy && styles.googleButtonDisabled]}
          onPress={handleSignIn}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={T.bg} />
          ) : (
            <>
              <Text style={styles.googleGlyph}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>
        {error && <Text style={styles.signInError}>{error}</Text>}
      </View>
    </View>
  );
}

function TabBar() {
  const insets = useSafeAreaInsets();
  const t = useThemePalette();
  const bottomPad = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? 10 : 14,
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.border,
          paddingBottom: bottomPad,
          paddingTop: 10,
          height: 64 + bottomPad,
        },
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.textDim,
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
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <IconSettings color={color} active={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: t.bg,
  },
  signInScreen: {
    flex: 1,
    backgroundColor: t.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  signInPanel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: t.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    padding: 22,
  },
  signInTitle: {
    color: t.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
  },
  signInSubtitle: {
    color: t.textSub,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  googleButton: {
    minHeight: 48,
    borderRadius: 10,
    marginTop: 22,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  googleButtonDisabled: {
    opacity: 0.7,
  },
  googleGlyph: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  googleButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  signInError: {
    color: '#F87171',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
});
