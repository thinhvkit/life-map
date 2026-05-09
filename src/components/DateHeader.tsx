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
  startOfYear,
  addDays,
  addMonths,
  subMonths,
  addYears,
  subYears,
  isSameDay,
  isSameMonth,
  isSameYear,
  isAfter,
  getYear,
  getMonth,
  setMonth,
  setYear,
} from 'date-fns';
import { useTrackingStore } from '../store/trackingStore';
import { T } from '../utils/theme';
import { formatDistance } from '../utils/geo';

type ViewMode = 'day' | 'month' | 'year';

export default function DateHeader() {
  const selectedDate = useTrackingStore(s => s.selectedDate);
  const dateMode = useTrackingStore(s => s.dateMode);
  const todayLog = useTrackingStore(s => s.todayLog);
  const setSelectedDate = useTrackingStore(s => s.setSelectedDate);
  const [visible, setVisible] = useState(false);

  const selected = parseISO(selectedDate);
  const label = useMemo(() => {
    if (dateMode === 'year') return format(selected, 'yyyy');
    if (dateMode === 'month') return format(selected, 'MMMM yyyy');
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
      <TouchableOpacity style={styles.header} onPress={() => setVisible(true)} activeOpacity={0.7}>
        <Text style={styles.dateText}>{label}</Text>
        {summary.length > 0 && <Text style={styles.summaryText}>{summary}</Text>}
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={styles.popup} onPress={e => e.stopPropagation()}>
            <CalendarPicker selected={selected} onSelect={onSelectWithMode} initialMode={dateMode} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function CalendarPicker({
  selected,
  onSelect,
  initialMode,
}: {
  selected: Date;
  onSelect: (d: Date, mode: ViewMode) => void;
  initialMode: ViewMode;
}) {
  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [viewDate, setViewDate] = useState(startOfMonth(selected));

  return (
    <View>
      {/* Mode tabs */}
      <View style={styles.modeTabs}>
        {(['day', 'month', 'year'] as ViewMode[]).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeTab, viewMode === mode && styles.modeTabActive]}
            onPress={() => setViewMode(mode)}
          >
            <Text style={[styles.modeTabText, viewMode === mode && styles.modeTabTextActive]}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {viewMode === 'day' && (
        <DayView
          viewDate={viewDate}
          setViewDate={setViewDate}
          selected={selected}
          today={today}
          onSelect={d => onSelect(d, 'day')}
          onTitlePress={() => setViewMode('month')}
        />
      )}
      {viewMode === 'month' && (
        <MonthView
          viewDate={viewDate}
          setViewDate={setViewDate}
          selected={selected}
          today={today}
          onSelect={d => onSelect(d, 'month')}
          onTitlePress={() => setViewMode('year')}
        />
      )}
      {viewMode === 'year' && (
        <YearView
          viewDate={viewDate}
          setViewDate={setViewDate}
          selected={selected}
          today={today}
          onSelect={d => onSelect(d, 'year')}
        />
      )}

      {/* Today shortcut */}
      <TouchableOpacity style={styles.todayBtn} onPress={() => onSelect(today, 'day')}>
        <Text style={styles.todayBtnText}>Today</Text>
      </TouchableOpacity>
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
  onTitlePress,
}: {
  viewDate: Date;
  setViewDate: (d: Date) => void;
  selected: Date;
  today: Date;
  onSelect: (d: Date) => void;
  onTitlePress: () => void;
}) {
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
        onTitlePress={onTitlePress}
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

// ── Month View (12 months grid) ──

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MonthView({
  viewDate,
  setViewDate,
  selected,
  today,
  onSelect,
  onTitlePress,
}: {
  viewDate: Date;
  setViewDate: (d: Date) => void;
  selected: Date;
  today: Date;
  onSelect: (d: Date) => void;
  onTitlePress: () => void;
}) {
  const viewYear = getYear(viewDate);
  const todayYear = getYear(today);
  const todayMonth = getMonth(today);
  const selYear = getYear(selected);
  const selMonth = getMonth(selected);

  const canGoNext = viewYear < todayYear;

  const rows: number[][] = [];
  for (let i = 0; i < 12; i += 4) {
    rows.push([i, i + 1, i + 2, i + 3]);
  }

  return (
    <View>
      <NavHeader
        label={String(viewYear)}
        onPrev={() => setViewDate(subYears(viewDate, 1))}
        onNext={() => canGoNext && setViewDate(addYears(viewDate, 1))}
        canNext={canGoNext}
        onTitlePress={onTitlePress}
      />

      {rows.map((row, ri) => (
        <View key={ri} style={styles.gridRow}>
          {row.map(m => {
            const isFuture = viewYear > todayYear || (viewYear === todayYear && m > todayMonth);
            const isSel = viewYear === selYear && m === selMonth;
            const isNow = viewYear === todayYear && m === todayMonth;

            return (
              <TouchableOpacity
                key={m}
                style={[styles.gridCell, isSel && styles.cellSelected]}
                onPress={() => !isFuture && onSelect(setMonth(viewDate, m))}
                disabled={isFuture}
                activeOpacity={0.6}
              >
                <Text
                  style={[
                    styles.gridCellText,
                    isFuture && { color: T.muted },
                    isSel && styles.cellTextSelected,
                    isNow && !isSel && styles.cellTextToday,
                  ]}
                >
                  {MONTH_LABELS[m]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ── Year View (decade grid) ──

function YearView({
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
  const viewYear = getYear(viewDate);
  const decadeStart = Math.floor(viewYear / 10) * 10;
  const todayYear = getYear(today);
  const selYear = getYear(selected);

  const canGoNext = decadeStart + 10 <= todayYear;

  const rows: number[][] = [];
  for (let i = 0; i < 12; i += 4) {
    rows.push([
      decadeStart - 1 + i,
      decadeStart + i,
      decadeStart + 1 + i,
      decadeStart + 2 + i,
    ]);
  }

  return (
    <View>
      <NavHeader
        label={`${decadeStart} – ${decadeStart + 9}`}
        onPrev={() => setViewDate(subYears(viewDate, 10))}
        onNext={() => canGoNext && setViewDate(addYears(viewDate, 10))}
        canNext={canGoNext}
      />

      {rows.map((row, ri) => (
        <View key={ri} style={styles.gridRow}>
          {row.map(y => {
            const inDecade = y >= decadeStart && y <= decadeStart + 9;
            const isFuture = y > todayYear;
            const isSel = y === selYear;
            const isNow = y === todayYear;

            return (
              <TouchableOpacity
                key={y}
                style={[styles.gridCell, isSel && styles.cellSelected]}
                onPress={() => !isFuture && onSelect(setYear(viewDate, y))}
                disabled={isFuture}
                activeOpacity={0.6}
              >
                <Text
                  style={[
                    styles.gridCellText,
                    !inDecade && { color: T.textDim },
                    isFuture && { color: T.muted },
                    isSel && styles.cellTextSelected,
                    isNow && !isSel && styles.cellTextToday,
                  ]}
                >
                  {y}
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'ios' ? 58 : 12,
    paddingBottom: 10,
    paddingHorizontal: 18,
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    gap: 8,
  },
  dateText: {
    color: T.text,
    fontSize: 16,
    fontWeight: '600',
  },
  summaryText: {
    color: T.textSub,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  chevron: {
    color: T.textSub,
    fontSize: 12,
    marginLeft: 2,
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 120 : 80,
  },
  popup: {
    backgroundColor: T.surface,
    borderRadius: 16,
    padding: 16,
    width: 320,
    borderWidth: 1,
    borderColor: T.border,
  },

  // Mode tabs
  modeTabs: {
    flexDirection: 'row',
    marginBottom: 14,
    backgroundColor: T.card,
    borderRadius: 10,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeTabActive: {
    backgroundColor: T.accent,
  },
  modeTabText: {
    color: T.textSub,
    fontSize: 12,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: '#fff',
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
    backgroundColor: T.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowText: {
    color: T.textSub,
    fontSize: 18,
    fontWeight: '600',
  },
  navLabel: {
    color: T.text,
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
    color: T.textDim,
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
    color: T.text,
    fontSize: 14,
    fontWeight: '500',
  },

  // Grid view (month & year)
  gridRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  gridCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    marginHorizontal: 2,
  },
  gridCellText: {
    color: T.text,
    fontSize: 14,
    fontWeight: '500',
  },

  // Shared selection states
  cellSelected: {
    backgroundColor: T.accent,
  },
  cellTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  cellTextToday: {
    color: T.accent,
    fontWeight: '700',
  },

  todayBtn: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
  },
  todayBtnText: {
    color: T.accent,
    fontSize: 13,
    fontWeight: '600',
  },
});
