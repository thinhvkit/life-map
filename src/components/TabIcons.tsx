import React from 'react';
import Svg, { Polygon, Line, Circle, Polyline } from 'react-native-svg';

interface TabIconProps {
  color: string;
  active: boolean;
}

export function IconMap({ color, active }: TabIconProps) {
  const sw = active ? 2 : 1.5;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Polygon
        points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1={9} y1={3} x2={9} y2={18} stroke={color} strokeWidth={sw} />
      <Line x1={15} y1={6} x2={15} y2={21} stroke={color} strokeWidth={sw} />
    </Svg>
  );
}

export function IconTimeline({ color, active }: TabIconProps) {
  const sw = active ? 2 : 1.5;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Line
        x1={8} y1={6} x2={21} y2={6}
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />
      <Line
        x1={8} y1={12} x2={21} y2={12}
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />
      <Line
        x1={8} y1={18} x2={21} y2={18}
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />
      <Circle cx={3} cy={6} r={1.5} fill={color} />
      <Circle cx={3} cy={12} r={1.5} fill={color} />
      <Circle cx={3} cy={18} r={1.5} fill={color} />
    </Svg>
  );
}

export function IconStats({ color, active }: TabIconProps) {
  const sw = active ? 2 : 1.5;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="22,12 18,12 15,21 9,3 6,12 2,12"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
