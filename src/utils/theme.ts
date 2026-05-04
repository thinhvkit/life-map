import { ActivityType, PlaceCategory } from '../models/types';

export const T = {
  bg: '#080E1C',
  surface: '#0D1526',
  card: '#111D30',
  border: '#1A2E4A',
  muted: '#233048',
  text: '#E8EFF8',
  textSub: '#7A92B0',
  textDim: '#3D5470',
  accent: '#3B8EF0',
};

export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  stationary: '#475B7A',
  walking: '#10B981',
  running: '#EF4444',
  cycling: '#3B8EF0',
  driving: '#8B5CF6',
  bus: '#F59E0B',
  train: '#EC4899',
  airplane: '#06B6D4',
  unknown: '#6B7280',
};

export const PLACE_COLORS: Record<PlaceCategory, string> = {
  home: '#10B981',
  work: '#3B8EF0',
  food: '#F59E0B',
  shopping: '#EC4899',
  transit: '#8B5CF6',
  fitness: '#EF4444',
  entertainment: '#06B6D4',
  other: '#6B7280',
};

export const PLACE_ICONS: Record<PlaceCategory, string> = {
  home: '⌂',
  work: '⚙',
  food: '◉',
  shopping: '⬡',
  transit: '⬟',
  fitness: '◈',
  entertainment: '◆',
  other: '◎',
};
