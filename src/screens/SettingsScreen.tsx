import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGroupStore } from '../store/groupStore';
import { useThemeStore, useThemedStyles } from '../store/themeStore';
import { Palette, ThemeMode } from '../utils/theme';

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const currentUser = useGroupStore(s => s.currentUser);
  const groupId = useGroupStore(s => s.groupId);
  const signOut = useGroupStore(s => s.signOut);
  const themeMode = useThemeStore(s => s.mode);
  const setThemeModeState = useThemeStore(s => s.setMode);
  const [busy, setBusy] = useState(false);

  const initials = getInitials(currentUser?.displayName, currentUser?.email);

  const handleSignOut = () => {
    Alert.alert('Log out?', 'You will stop sharing live location on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await signOut();
          } catch (e: any) {
            Alert.alert('Logout failed', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.accountCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.accountText}>
          <Text style={styles.name} numberOfLines={1}>
            {currentUser?.displayName ?? 'Signed in'}
          </Text>
          {!!currentUser?.email && (
            <Text style={styles.email} numberOfLines={1}>
              {currentUser.email}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Theme</Text>
          <View style={styles.segment}>
            {THEME_OPTIONS.map(opt => {
              const active = themeMode === opt.mode;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => setThemeModeState(opt.mode)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      active && styles.segmentTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Family group</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {groupId}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>User ID</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {currentUser?.uid ?? '-'}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.logoutButton, busy && styles.disabledButton]}
        onPress={handleSignOut}
        disabled={busy}
        activeOpacity={0.82}
      >
        {busy ? (
          <ActivityIndicator color="#FCA5A5" />
        ) : (
          <Text style={styles.logoutText}>Log out</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function getInitials(name?: string | null, email?: string | null) {
  const source = name || email || 'LM';
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.bg,
    paddingHorizontal: 18,
  },
  title: {
    color: t.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 18,
  },
  accountCard: {
    minHeight: 88,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: t.card,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: t.border,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  segmentItemActive: {
    backgroundColor: t.accent,
  },
  segmentText: {
    color: t.textSub,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#fff',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#153C35',
    borderWidth: 1,
    borderColor: '#1E6B59',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#A7F3D0',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  accountText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: t.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  email: {
    color: t.textSub,
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  sectionLabel: {
    color: t.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 2,
  },
  row: {
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  rowLabel: {
    color: t.text,
    fontSize: 15,
    fontWeight: '700',
  },
  rowValue: {
    flex: 1,
    color: t.textSub,
    fontSize: 13,
    textAlign: 'right',
  },
  logoutButton: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#2A1016',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  disabledButton: {
    opacity: 0.65,
  },
  logoutText: {
    color: '#FCA5A5',
    fontSize: 15,
    fontWeight: '800',
  },
});
