import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polygon, Line, Circle, Polyline, Path, Defs, LinearGradient, Stop, Ellipse } from 'react-native-svg';

interface TabIconProps {
  color: string;
  active: boolean;
}

// Map tab — blue glow
export function IconMap({ color, active }: TabIconProps) {
  const glowColor = '#3B8EF0';
  const sw = active ? 2.5 : 2;
  return (
    <View style={[styles.iconBox, active && { shadowColor: glowColor, shadowOpacity: 0.9, shadowRadius: 14, elevation: 10 }]}>
      <Svg width={36} height={36} viewBox="0 0 24 24" fill="none">
        <Defs>
          <LinearGradient id="mapGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#60A5FA" />
            <Stop offset="100%" stopColor="#2563EB" />
          </LinearGradient>
        </Defs>
        <Polygon
          points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"
          stroke={active ? '#60A5FA' : color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={active ? 'rgba(59,142,240,0.12)' : 'none'}
        />
        <Line x1={9} y1={3} x2={9} y2={18} stroke={active ? '#93C5FD' : color} strokeWidth={sw} />
        <Line x1={15} y1={6} x2={15} y2={21} stroke={active ? '#93C5FD' : color} strokeWidth={sw} />
        <Circle cx={12} cy={11} r={1.8} fill={active ? '#60A5FA' : color} />
      </Svg>
    </View>
  );
}

// Timeline tab — purple glow
export function IconTimeline({ color, active }: TabIconProps) {
  const glowColor = '#8B5CF6';
  const sw = active ? 2.5 : 2;
  const dotFill = active ? '#A78BFA' : color;
  const lineFill = active ? '#C4B5FD' : color;
  return (
    <View style={[styles.iconBox, active && { shadowColor: glowColor, shadowOpacity: 0.9, shadowRadius: 14, elevation: 10 }]}>
      <Svg width={36} height={36} viewBox="0 0 24 24" fill="none">
        <Line x1={4} y1={4} x2={4} y2={20} stroke={active ? '#8B5CF6' : color} strokeWidth={sw - 0.5} strokeLinecap="round" />
        <Circle cx={4} cy={6} r={2} fill={dotFill} />
        <Line x1={8} y1={6} x2={21} y2={6} stroke={lineFill} strokeWidth={sw} strokeLinecap="round" />
        <Circle cx={4} cy={12} r={2} fill={dotFill} />
        <Line x1={8} y1={12} x2={19} y2={12} stroke={lineFill} strokeWidth={sw} strokeLinecap="round" />
        <Circle cx={4} cy={18} r={2} fill={dotFill} />
        <Line x1={8} y1={18} x2={21} y2={18} stroke={lineFill} strokeWidth={sw} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

// Stats tab — amber/gold glow
export function IconStats({ color, active }: TabIconProps) {
  const glowColor = '#F59E0B';
  const sw = active ? 2.5 : 2;
  return (
    <View style={[styles.iconBox, active && { shadowColor: glowColor, shadowOpacity: 0.9, shadowRadius: 14, elevation: 10 }]}>
      <Svg width={36} height={36} viewBox="0 0 24 24" fill="none">
        <Polyline
          points="2,12 5,12 7,5 10,19 13,10 16,14 18,8 21,12 23,12"
          stroke={active ? '#FCD34D' : color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={13} cy={10} r={1.5} fill={active ? '#F59E0B' : color} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBox: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
});
