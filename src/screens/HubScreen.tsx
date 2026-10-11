import { useId, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { generateSeries, HISTORY_TICKS } from '../game/duel';
import { GameId, GAMES, GameInfo } from '../games';
import { useStore } from '../state/store';
import { ClockIcon, SlidersIcon, UsersIcon } from '../ui/icons';
import { Button } from '../ui/kit';
import { Glass, LiftPressable, ShinyCoin, useCountUp } from '../ui/luxe';
import { fonts, radius, space, type } from '../ui/theme';

export function HubScreen({
  onPlay,
  onSettings,
  onWallet,
  starting,
}: {
  onPlay: (id: GameId) => void;
  onSettings: () => void;
  onWallet: () => void;
  /** A match is being opened on the server. */
  starting: boolean;
}) {
  const { colors, t, profile, fmt, haptic, balance } = useStore();
  const stats = profile?.stats ?? { matches: 0, wins: 0, earned: 0 };
  const shownBalance = useCountUp(balance);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: colors.goldHi }]} numberOfLines={1}>
          Market Combat
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.settings')}
          hitSlop={10}
          onPress={() => {
            haptic('tap');
            onSettings();
          }}
          style={({ pressed }) => [styles.iconButton, { borderColor: colors.glassEdge, backgroundColor: colors.glass, opacity: pressed ? 0.7 : 1 }]}
        >
          <SlidersIcon color={colors.goldHi} size={20} />
        </Pressable>
      </View>

      <LiftPressable onPress={onWallet} accessibilityLabel={t('wallet.title')}>
        <Glass style={styles.pocket}>
          <View style={styles.balanceRow}>
            <ShinyCoin size={68} />
            <View style={styles.balanceText}>
              <Text style={[styles.balanceLabel, { color: colors.muted }]}>{t('wallet.balance')}</Text>
              <View style={styles.amountRow}>
                <Text style={[styles.amount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                  {fmt(shownBalance)}
                </Text>
                <Text style={[styles.ticker, { color: colors.gold }]}>ABIE</Text>
              </View>
            </View>
          </View>

          <View style={[styles.rule, { backgroundColor: colors.glassEdge }]} />

          <View style={styles.playerRow}>
            <Text style={[styles.nick, { color: colors.text }]} numberOfLines={1}>
              {profile?.nickname ?? ''}
            </Text>
            <View style={styles.stats}>
              <Stat label={t('stats.matches')} value={fmt(stats.matches)} />
              <Stat label={t('stats.wins')} value={fmt(stats.wins)} />
              <Stat label={t('stats.earned')} value={fmt(stats.earned)} gold />
            </View>
          </View>
        </Glass>
      </LiftPressable>

      <Text style={[styles.section, { color: colors.text }]}>{t('hub.games')}</Text>

      {GAMES.map((g) => (
        <GameTile key={g.id} game={g} onPlay={() => onPlay(g.id)} starting={starting} />
      ))}

      <Glass quiet style={styles.soon}>
        <Text style={[styles.soonTitle, { color: colors.text }]}>{t('hub.soonTitle')}</Text>
        <Text style={[type.body, { color: colors.muted }]}>{t('hub.soonText')}</Text>
      </Glass>
    </ScrollView>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  const { colors } = useStore();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: gold ? colors.gold : colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A glowing slice of a real Chart Duel price line, as a shop-window display. */
function ChartVignette({ width, height }: { width: number; height: number }) {
  const { colors } = useStore();
  const base = useId().replace(/[^a-zA-Z0-9]/g, '');
  const prices = useMemo(() => generateSeries(20261011).prices.slice(HISTORY_TICKS - 10, HISTORY_TICKS + 150), []);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const padTop = 18;
  const padBottom = 10;
  const pts = prices.map((p, i) => [(i / (prices.length - 1)) * width, padTop + (1 - (p - lo) / (hi - lo || 1)) * (height - padTop - padBottom)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const [ex, ey] = pts[pts.length - 1];

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={`${base}s`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.goldLo} stopOpacity={0.4} />
          <Stop offset="0.6" stopColor={colors.gold} />
          <Stop offset="1" stopColor={colors.goldHi} />
        </LinearGradient>
        <LinearGradient id={`${base}a`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.gold} stopOpacity={0.28} />
          <Stop offset="1" stopColor={colors.gold} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${base}a)`} />
      <Path d={line} fill="none" stroke={colors.gold} strokeOpacity={0.18} strokeWidth={7} strokeLinejoin="round" />
      <Path d={line} fill="none" stroke={`url(#${base}s)`} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={ex - 2} cy={ey} r={9} fill={colors.goldHi} fillOpacity={0.18} />
      <Circle cx={ex - 2} cy={ey} r={4} fill={colors.goldHi} />
    </Svg>
  );
}

function GameTile({ game, onPlay, starting }: { game: GameInfo; onPlay: () => void; starting: boolean }) {
  const { colors, t } = useStore();
  const [width, setWidth] = useState(0);

  return (
    <LiftPressable onPress={onPlay} disabled={starting} accessibilityLabel={t(game.title)}>
      <Glass style={styles.tile}>
        <View style={styles.vignette} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
          {width > 0 && <ChartVignette width={width} height={128} />}
        </View>
        <View style={styles.tileBody}>
          <Text style={[styles.tileTitle, { color: colors.text }]} numberOfLines={2}>
            {t(game.title)}
          </Text>
          <Text style={[type.body, { color: colors.muted }]}>{t(game.tagline)}</Text>
          <View style={styles.meta}>
            <View style={styles.metaItem}>
              <UsersIcon color={colors.gold} />
              <Text style={[styles.metaText, { color: colors.text }]}>{game.players}</Text>
            </View>
            <View style={styles.metaItem}>
              <ClockIcon color={colors.gold} />
              <Text style={[styles.metaText, { color: colors.text }]}>
                {game.seconds} {t('unit.sec')}
              </Text>
            </View>
            {game.offline && (
              <View style={[styles.tag, { borderColor: colors.glassEdge }]}>
                <Text style={[styles.tagText, { color: colors.muted }]}>{t('hub.vsBots')}</Text>
              </View>
            )}
          </View>
          <Button label={t('hub.play')} onPress={onPlay} big disabled={starting} />
        </View>
      </Glass>
    </LiftPressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: space.lg, gap: 22, paddingBottom: space.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wordmark: { flex: 1, fontFamily: fonts.display, fontSize: 34, letterSpacing: 0.3 },
  iconButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pocket: { padding: 20, gap: 18 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  balanceText: { flex: 1, minWidth: 0 },
  balanceLabel: { fontSize: 13, letterSpacing: 0.3 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  amount: { fontFamily: fonts.display, fontSize: 54, lineHeight: 60, flexShrink: 1 },
  ticker: { fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  rule: { height: StyleSheet.hairlineWidth },
  playerRow: { gap: 12 },
  nick: { fontFamily: fonts.displaySemi, fontSize: 22 },
  stats: { flexDirection: 'row', gap: space.md },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: fonts.displaySemi, fontSize: 24, lineHeight: 28 },
  statLabel: { fontSize: 12 },
  section: { fontFamily: fonts.displaySemi, fontSize: 24, marginBottom: -8 },
  tile: { padding: 0 },
  vignette: { height: 128, marginTop: 8 },
  tileBody: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4, gap: 12 },
  tileTitle: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 14, fontWeight: '700' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  tagText: { fontSize: 12, fontWeight: '600' },
  soon: { padding: 20, gap: 6 },
  soonTitle: { fontFamily: fonts.displaySemi, fontSize: 20 },
});
