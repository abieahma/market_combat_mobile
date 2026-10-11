// Small hand-drawn icons (react-native-svg), so there is no icon font to load.

import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

interface IconProps {
  size?: number;
  color: string;
}

/** The ABIE coin. */
export function AbieCoin({ size = 18, color, ink }: IconProps & { ink: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={11} fill={color} />
      <Circle cx={12} cy={12} r={8.6} fill="none" stroke={ink} strokeOpacity={0.35} strokeWidth={1.2} />
      <Path d="M12 6.2 L16.6 17.4 H14.5 L13.6 15 H10.4 L9.5 17.4 H7.4 Z M11 13.2 H13 L12 10.4 Z" fill={ink} fillRule="evenodd" />
    </Svg>
  );
}

export function SlidersIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1={4} y1={7} x2={20} y2={7} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={4} y1={17} x2={20} y2={17} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={9} cy={7} r={2.6} fill={color} />
      <Circle cx={15} cy={17} r={2.6} fill={color} />
    </Svg>
  );
}

export function ChevronLeft({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 5 L8 12 L15 19" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function UsersIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={9} cy={8} r={3.4} fill={color} />
      <Path d="M2.5 19.5 C3 15.6 5.6 13.6 9 13.6 C12.4 13.6 15 15.6 15.5 19.5 Z" fill={color} />
      <Circle cx={16.6} cy={8.6} r={2.7} fill={color} opacity={0.6} />
      <Path d="M16.4 13.4 C19.4 13.5 21.1 15.4 21.5 18.6 H17.2 C16.9 16.6 16.2 14.9 14.9 13.7 C15.4 13.5 15.9 13.4 16.4 13.4 Z" fill={color} opacity={0.6} />
    </Svg>
  );
}

export function ClockIcon({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2} />
      <Path d="M12 7 V12 L15.2 14" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ArrowUp({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 19 V5 M6 11 L12 5 L18 11" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ArrowDown({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 5 V19 M6 13 L12 19 L18 13" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Tiny candlestick mark used on the Chart Duel card. */
export function CandlesIcon({ size = 20, color, up, down }: IconProps & { up: string; down: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Line x1={6} y1={4} x2={6} y2={18} stroke={down} strokeWidth={1.6} />
      <Rect x={4} y={7} width={4} height={7} rx={1} fill={down} />
      <Line x1={12} y1={6} x2={12} y2={20} stroke={up} strokeWidth={1.6} />
      <Rect x={10} y={9} width={4} height={8} rx={1} fill={up} />
      <Line x1={18} y1={3} x2={18} y2={15} stroke={color} strokeWidth={1.6} />
      <Rect x={16} y={5} width={4} height={6} rx={1} fill={color} />
    </Svg>
  );
}
