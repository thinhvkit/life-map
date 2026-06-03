import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import {
  format,
  isToday,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameDay,
  isSameMonth,
  isSameWeek,
  isAfter,
} from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrackingStore } from '../store/trackingStore';
import { T, Palette } from '../utils/theme';
import { useThemedStyles } from '../store/themeStore';
import { formatDistance } from '../utils/geo';

type ViewMode = 'day' | 'week' | 'month';

export default function DateHeader() {
  const styles = useThemedStyles(makeStyles);
  const selectedDate = useTrackingStore(s => s.selectedDate);
  const dateMode = useTrackingStore(s => s.dateMode);
  const todayLog = useTrackingStore(s => s.todayLog);
  const setSelectedDate = useTrackingStore(s => s.setSelectedDate);
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const selected = parseISO(selectedDate);
  const label = useMemo(() => {
    const now = new Date();
    if (dateMode === 'week') {
      if (isSameWeek(selected, now, { weekStartsOn: 1 })) return 'This Week';
      const ws = startOfWeek(selected, { weekStartsOn: 1 });
      const we = endOfWeek(selected, { weekStartsOn: 1 });
      return `${format(ws, 'MMM d')} – ${format(we, 'MMM d')}`;
    }
    if (dateMode === 'month') {
      return isSameMonth(selected, now) ? 'This Month' : format(selected, 'MMMM yyyy');
    }
    return isToday(selected) ? 'Today' : format(selected, 'EEE, MMM d');
  }, [selected, dateMode]);

  const summary = useMemo(() => {
    if (!todayLog) return '';
    const parts: string[] = [];
    if (todayLog.totalDistance > 0) parts.push(formatDistance(todayLog.totalDistance));
    if (todayLog.placesVisited > 0) parts.push(`${todayLog.placesVisited} places`);
    return parts.join(' · ');
  }, [todayLog]);

  const onSelectWithMode = useCallback(
    (date: Date, mode: ViewMode) => {
      setSelectedDate(format(date, 'yyyy-MM-dd'), mode);
      setVisible(false);
    },
    [setSelectedDate],
  );

  return (
    <>
      <TouchableOpacity
        style={[styles.header, { paddingTop: insets.top + 8 }]}
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.dateText}>{label}</Text>
        {summary.length > 0 && <Text style={styles.summaryText}>{summary}</Text>}
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <Pressable
          style={[styles.backdrop, { paddingTop: insets.top + 70 }]}
          onPress={() => setVisible(false)}
        >
          <Pressable style={styles.popup} onPress={e => e.stopPropagation()}>
            <CalendarPicker selected={selected} onSelect={onSelectWithMode} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function CalendarPicker({
  selected,
  onSelect,
}: {
  selected: Date;
  onSelect: (d: Date, mode: ViewMode) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const today = new Date();
  const [viewDate, setViewDate] = useState(startOfMonth(selected));

  const shortcuts: { label: string; mode: ViewMode }[] = [
    { label: 'Today', mode: 'day' },
    { label: 'This Week', mode: 'week' },
    { label: 'This Month', mode: 'month' },
  ];

  return (
    <View>
      <DayView
        viewDate={viewDate}
        setViewDate={setViewDate}
        selected={selected}
        today={today}
        onSelect={d => onSelect(d, 'day')}
      />

      {/* Range shortcuts */}
      <View style={styles.shortcutRow}>
        {shortcuts.map(s => (
          <TouchableOpacity
            key={s.label}
            style={styles.shortcutBtn}
            onPress={() => onSelect(today, s.mode)}
            activeOpacity={0.8}
          >
            <Text style={styles.shortcutText}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Day View (calendar grid) ──

function DayView({
  viewDate,
  setViewDate,
  selected,
  today,
  onSelect,
}: {
  viewDate: Date;
  setViewDate: (d: Date) => void;
  selected: Date;
  today: Date;
  onSelect: (d: Date) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const weeks = useMemo(() => {
    const monthStart = startOfMonth(viewDate);
    const monthEnd = endOfMonth(viewDate);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const rows: Date[][] = [];
    let day = calStart;
    while (day <= calEnd) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(day);
        day = addDays(day, 1);
      }
      rows.push(week);
    }
    return rows;
  }, [viewDate]);

  const canGoNext = !isAfter(startOfMonth(addMonths(viewDate, 1)), startOfMonth(today));

  return (
    <View>
      <NavHeader
        label={format(viewDate, 'MMMM yyyy')}
        onPrev={() => setViewDate(subMonths(viewDate, 1))}
        onNext={() => canGoNext && setViewDate(addMonths(viewDate, 1))}
        canNext={canGoNext}
      />

      <View style={styles.weekRow}>
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
          <Text key={d} style={styles.weekDay}>{d}</Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            const inMonth = isSameMonth(day, viewDate);
            const isSel = isSameDay(day, selected);
            const isNow = isSameDay(day, today);
            const isFuture = isAfter(day, today);

            return (
              <TouchableOpacity
                key={di}
                style={[styles.dayCell, isSel && styles.cellSelected]}
                onPress={() => !isFuture && onSelect(day)}
                disabled={isFuture}
                activeOpacity={0.6}
              >
                <Text
                  style={[
                    styles.dayText,
                    !inMonth && { color: T.textDim },
                    isFuture && { color: T.muted },
                    isSel && styles.cellTextSelected,
                    isNow && !isSel && styles.cellTextToday,
                  ]}
                >
                  {format(day, 'd')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ── Shared Nav Header ──

function NavHeader({
  label,
  onPrev,
  onNext,
  canNext,
  onTitlePress,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  canNext: boolean;
  onTitlePress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.navHeader}>
      <TouchableOpacity onPress={onPrev} style={styles.navArrow}>
        <Text style={styles.navArrowText}>‹</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onTitlePress} disabled={!onTitlePress}>
        <Text style={styles.navLabel}>{label}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onNext}
        style={styles.navArrow}
        disabled={!canNext}
      >
        <Text style={[styles.navArrowText, !canNext && { color: T.textDim }]}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 10,
    paddingHorizontal: 18,
    backgroundColor: t.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
    gap: 8,
  },
  dateText: {
    color: t.text,
    fontSize: 16,
    fontWeight: '600',
  },
  summaryText: {
    color: t.textSub,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  chevron: {
    color: t.textSub,
    fontSize: 12,
    marginLeft: 2,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  popup: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 16,
    width: 320,
    borderWidth: 1,
    borderColor: t.border,
  },

  // Nav header
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navArrow: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowText: {
    color: t.textSub,
    fontSize: 18,
    fontWeight: '600',
  },
  navLabel: {
    color: t.text,
    fontSize: 15,
    fontWeight: '600',
  },

  // Day view
  weekRow: {
    flexDirection: 'row',
  },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    color: t.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  dayText: {
    color: t.text,
    fontSize: 14,
    fontWeight: '500',
  },

  // Selection states
  cellSelected: {
    backgroundColor: t.accent,
  },
  cellTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  cellTextToday: {
    color: t.accent,
    fontWeight: '700',
  },

  // Range shortcuts
  shortcutRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  shortcutBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
  },
  shortcutText: {
    color: t.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});

