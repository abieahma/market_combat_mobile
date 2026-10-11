import { useId, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { Colors, radius, type } from '../ui/theme';

interface Props {
  prices: number[];
  /** Index in `prices` where the match starts (vertical marker). */
  startIndex: number;
  /** Total number of points the full match will have; fixes the x-scale. */
  totalPoints: number;
  entry?: { price: number; side: 1 | -1 } | null;
  entryLabel?: string;
  formatPrice: (v: number) => string;
  colors: Colors;
  height: number;
}

const LABEL_GUTTER = 64;
const PAD_Y = 14;

function safeId(raw: string) {
  return 'g' + raw.replace(/[^a-zA-Z0-9]/g, '');
}

export function PriceChart({ prices, startIndex, totalPoints, entry, entryLabel, formatPrice, colors, height }: Props) {
  const [width, setWidth] = useState(0);
  const gradientId = safeId(useId());
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const last = prices[prices.length - 1];
  const open = prices[Math.min(startIndex, prices.length - 1)];
  const lineColor = last >= open ? colors.up : colors.down;

  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (entry) {
    lo = Math.min(lo, entry.price);
    hi = Math.max(hi, entry.price);
  }
  const minSpan = last * 0.012;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;

  const plotW = Math.max(0, width - LABEL_GUTTER);
  const x = (i: number) => (i / Math.max(1, totalPoints - 1)) * plotW;
  const y = (p: number) => PAD_Y + (1 - (p - lo) / (hi - lo)) * (height - PAD_Y * 2);

  let line = '';
  prices.forEach((p, i) => {
    line += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p).toFixed(1)} `;
  });
  const lastX = x(prices.length - 1);
  const lastY = y(last);
  const area = `${line}L${lastX.toFixed(1)} ${height} L0 ${height} Z`;
  const entryY = entry ? y(entry.price) : 0;
  const entryColor = entry ? (entry.side === 1 ? colors.up : colors.down) : colors.muted;

  return (
    <View style={{ height }} onLayout={onLayout}>
      {width > 0 && (
        <>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lineColor} stopOpacity={0.28} />
                <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={0} x2={plotW} y1={height * f} y2={height * f} stroke={colors.line} strokeWidth={1} strokeOpacity={0.6} />
            ))}
            <Line x1={x(startIndex)} x2={x(startIndex)} y1={0} y2={height} stroke={colors.faint} strokeWidth={1} strokeDasharray="3 4" />
            <Path d={area} fill={`url(#${gradientId})`} />
            <Path d={line} fill="none" stroke={lineColor} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
            {entry && (
              <Line x1={0} x2={plotW + 6} y1={entryY} y2={entryY} stroke={entryColor} strokeWidth={1.4} strokeDasharray="6 4" />
            )}
            <Line x1={lastX} x2={plotW + 6} y1={lastY} y2={lastY} stroke={lineColor} strokeWidth={1} strokeOpacity={0.6} strokeDasharray="2 3" />
            <Circle cx={lastX} cy={lastY} r={7} fill={lineColor} fillOpacity={0.25} />
            <Circle cx={lastX} cy={lastY} r={3.6} fill={lineColor} />
          </Svg>

          {entry && (
            <View style={[styles.entryTag, { top: entryY - 9, borderColor: entryColor, backgroundColor: colors.surface }]}>
              <Text style={[styles.entryText, { color: entryColor }]}>
                {entryLabel} {formatPrice(entry.price)}
              </Text>
            </View>
          )}
          <View style={[styles.priceTag, { top: lastY - 11, left: plotW + 6, backgroundColor: lineColor }]}>
            <Text style={[styles.priceText, { color: colors.onSide }]} numberOfLines={1}>
              {formatPrice(last)}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

/** Small static line for cards. */
export function Sparkline({ prices, width, height, color }: { prices: number[]; width: number; height: number; color: string }) {
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const d = prices
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (prices.length - 1)) * width).toFixed(1)} ${(3 + (1 - (p - lo) / (hi - lo || 1)) * (height - 6)).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width={width} height={height}>
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  priceTag: {
    position: 'absolute',
    minWidth: LABEL_GUTTER - 8,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceText: { fontSize: 12, fontWeight: '800', ...type.num },
  entryTag: {
    position: 'absolute',
    left: 6,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
  },
  entryText: { fontSize: 11, fontWeight: '700', ...type.num },
});
