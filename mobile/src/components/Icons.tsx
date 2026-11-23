// Hand-drawn hairline icons (SVG) so the tab bar feels like engraving, not emoji.
import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number; weight?: number };

export const IconHome = ({ color, size = 24, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Path d="M5 21V10a7 7 0 0 1 14 0v11" />
    <Line x1="12" y1="3" x2="12" y2="21" />
    <Line x1="5" y1="13" x2="19" y2="13" />
    <Line x1="3" y1="21" x2="21" y2="21" />
  </Svg>
);

export const IconLibrary = ({ color, size = 24, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Rect x="3.5" y="4" width="4" height="16" />
    <Rect x="8.5" y="6" width="4" height="14" />
    <Path d="M14.2 7.2l3.6-1 3.6 13.4-3.6 1z" />
    <Line x1="2" y1="20.5" x2="22" y2="20.5" />
  </Svg>
);

export const IconFinder = ({ color, size = 26, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Path d="M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4" />
    <Path d="M5.5 12s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S5.5 12 5.5 12z" />
    <Circle cx="12" cy="12" r="1.8" />
  </Svg>
);

export const IconAdd = ({ color, size = 24, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Rect x="5" y="3" width="14" height="18" />
    <Line x1="12" y1="8.5" x2="12" y2="15.5" />
    <Line x1="8.5" y1="12" x2="15.5" y2="12" />
  </Svg>
);

export const IconSettings = ({ color, size = 24, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Circle cx="12" cy="12" r="8.5" />
    <Circle cx="12" cy="12" r="2.5" />
    <Line x1="12" y1="3.5" x2="12" y2="6" />
    <Line x1="12" y1="18" x2="12" y2="20.5" />
    <Line x1="3.5" y1="12" x2="6" y2="12" />
    <Line x1="18" y1="12" x2="20.5" y2="12" />
  </Svg>
);

export const IconHeart = ({ color, size = 22, weight = 1.2, filled = false }: P & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={weight}>
    <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Svg>
);

export const IconClose = ({ color, size = 22, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Line x1="5" y1="5" x2="19" y2="19" />
    <Line x1="19" y1="5" x2="5" y2="19" />
  </Svg>
);

export const IconBack = ({ color, size = 22, weight = 1.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={weight}>
    <Path d="M15 5l-7 7 7 7" />
  </Svg>
);
