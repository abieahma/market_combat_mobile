import { useId, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Avatar, AvatarPlaceholder } from '../components/Avatar';
import { rateText } from '../components/StakeSheet';
import { generateSeries, HISTORY_TICKS } from '../game/duel';
import { ShownGame, shownGames } from '../games';
import { useStore } from '../state/store';
import { ClockIcon, SlidersIcon, UsersIcon } from '../ui/icons';
import { Button } from '../ui/kit';
import { Glass, LiftPressable, ShinyCoin, useCountUp } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { CHARACTER_IDS, CharacterId } from '../api/contract';
import { COUNTRIES } from '../wallet/countries';
import { characterName, CHARACTERS, worldColor } from '../world/characters';
import { useLookStyles, useType } from '../ui/look';

export function HubScreen({
  onPlay,
  onChoose,
  onPayEntry,
  onPropose,
  onSettings,
  onWallet,
  starting,
}: {
  onPlay: (game: ShownGame) => void;
  /** Opens a paid game (one payment). */
  onPayEntry: (game: ShownGame) => void;
  /** Proposals of new games. */
  onPropose: () => void;
  /** Opens the character choice (needed before any game). */
  onChoose: () => void;
  onSettings: () => void;
  onWallet: () => void;
  /** A match is being opened on the server. */
  starting: boolean;
}) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, profile, fmt, haptic, balance, scheme, settings, games, opened, look, universe } = useStore();
  const brand = scheme === 'dark' ? colors.goldHi : colors.gold;
  // The character stays with the player in the neutral cabinet; its universe is on only inside.
  const character = profile?.character ?? null;
  const world = universe ? CHARACTERS[universe] : null;
  const shown = shownGames(games, universe, opened);
  const country = profile?.country ? COUNTRIES[profile.country.code] : null;
  const stats = profile?.stats ?? { matches: 0, wins: 0, earned: 0 };
  const shownBalance = useCountUp(balance);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {look.header && universe && world ? (
        <BrandHeader universe={universe} onSettings={onSettings} />
      ) : (
        <View style={styles.header}>
          <Text style={[styles.wordmark, { color: brand }]} numberOfLines={1}>
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
            <SlidersIcon color={brand} size={20} />
          </Pressable>
        </View>
      )}

      <LiftPressable onPress={onWallet} accessibilityLabel={t('wallet.title')}>
        <Glass style={styles.pocket}>
          <View style={styles.balanceRow}>
            <ShinyCoin size={68} />
            <View style={styles.balanceText}>
              <Text style={[styles.balanceLabel, { color: colors.muted }]}>{t(world ? world.text.balance : 'wallet.balance')}</Text>
              <View style={styles.amountRow}>
                <Text style={[styles.amount, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                  {fmt(shownBalance)}
                </Text>
                <Text style={[styles.ticker, { color: colors.goldText }]}>ABIE</Text>
              </View>
            </View>
          </View>

          <View style={[styles.rule, { backgroundColor: colors.glassEdge }]} />

          <View style={styles.playerRow}>
            <View style={styles.who}>
              {character ? (
                <View style={!universe && styles.away}>
                  <Avatar character={character} gender={profile?.gender ?? 'm'} size={64} />
                </View>
              ) : (
                <AvatarPlaceholder size={64} />
              )}
              <View style={styles.whoText}>
                <Text style={[styles.nick, { color: colors.text }]} numberOfLines={1}>
                  {profile?.nickname ?? ''}
                </Text>
                {!universe && country && profile?.country && (
                  <Text style={[styles.country, { color: colors.muted }]} numberOfLines={1}>
                    {t('country.title')}: {country.flag} {profile.country.code} · {profile.country.currency}
                  </Text>
                )}
                {(!character || !universe) && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={character ? t('uni.back') : t('hub.choose')}
                    hitSlop={8}
                    onPress={() => {
                      haptic('tap');
                      onChoose();
                    }}
                    style={({ pressed }) => [styles.chooseLink, { borderColor: colors.gold, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.chooseText, { color: colors.goldText }]}>{character ? t('uni.back') : t('hub.choose')}</Text>
                  </Pressable>
                )}
                {universe && world && (
                  <Text style={styles.worldLine} numberOfLines={2}>
                    <Text style={[styles.charName, { color: look.brand ? colors.world : worldColor(universe, scheme) }]}>{characterName(universe, settings.lang)}</Text>
                    <Text style={{ color: colors.muted }}>{'  ·  '}{t(world.text.role)}</Text>
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.stats}>
              <Stat label={t('stats.matches')} value={fmt(stats.matches)} />
              <Stat label={t('stats.wins')} value={fmt(stats.wins)} />
              <Stat
                label={t('stats.earned')}
                value={`${stats.earned > 0 ? '+' : ''}${fmt(stats.earned)}`}
                color={stats.earned < 0 ? colors.down : colors.goldText}
              />
            </View>
          </View>
        </Glass>
      </LiftPressable>

      <View style={styles.sectionHead}>
        <Text style={[styles.section, { color: colors.text }]}>{t(world ? world.text.games : 'hub.games')}</Text>
        {!universe && <Text style={[tp.body, { color: colors.muted }]}>{character ? t('uni.outside') : t('hub.chooseFirst')}</Text>}
      </View>

      {shown.map((g) => (
        <GameTile
          key={g.info.id}
          game={g}
          onPress={() => (!g.playable ? onChoose() : g.needsEntry ? onPayEntry(g) : onPlay(g))}
          starting={starting}
          playLabel={
            !g.playable
              ? character
                ? t('uni.back')
                : t('hub.choose')
              : g.needsEntry && g.entry?.entry.kind === 'paid'
                ? tf('entry.pay', { price: fmt(g.entry.entry.price) })
                : t(world ? world.text.play : 'hub.play')
          }
        />
      ))}

      <Glass quiet style={styles.soon}>
        <Text style={[styles.soonTitle, { color: colors.text }]}>{t('hub.soonTitle')}</Text>
        <Text style={[tp.body, { color: colors.muted }]}>{t('prop.lead')}</Text>
        <Button label={t('prop.title')} onPress={onPropose} variant="glass" style={styles.soonButton} />
      </Glass>
    </ScrollView>
  );
}

/** Header of a universe: its colours behind the name of the world, like the top bar of a marketplace app. */
function BrandHeader({ universe, onSettings }: { universe: CharacterId; onSettings: () => void }) {
  const styles = useLookStyles(baseStyles);
  const { t, settings, look, haptic } = useStore();
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const h = look.header!;
  return (
    <View style={[styles.brandHeader, { borderBottomLeftRadius: look.shape.card, borderBottomRightRadius: look.shape.card }]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`hdr${raw}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={h.from} />
            <Stop offset="1" stopColor={h.to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#hdr${raw})`} />
      </Svg>
      <View style={styles.brandRow}>
        <View style={styles.brandText}>
          <Text style={[styles.brandTitle, { color: h.ink }]} numberOfLines={1}>
            {characterName(universe, settings.lang)}
          </Text>
          <Text style={[styles.brandSub, { color: h.sub }]} numberOfLines={2}>
            {t(CHARACTERS[universe].text.hello)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.settings')}
          hitSlop={10}
          onPress={() => {
            haptic('tap');
            onSettings();
          }}
          style={({ pressed }) => [styles.brandButton, { borderColor: h.ink, opacity: pressed ? 0.7 : 1 }]}
        >
          <SlidersIcon color={h.ink} size={20} />
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useLookStyles(baseStyles);
  const { colors } = useStore();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: color ?? colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Two fighters of the universes facing each other, for the Market Kombat window. */
function KombatVignette({ width, height }: { width: number; height: number }) {
  const styles = useLookStyles(baseStyles);
  const { colors, profile } = useStore();
  const mine = profile?.character ?? 'waldberik';
  const rival = CHARACTER_IDS[(CHARACTER_IDS.indexOf(mine) + 2) % CHARACTER_IDS.length];
  const size = Math.min(104, height - 16);
  return (
    <View style={[styles.versus, { width, height }]}>
      <Avatar character={mine} gender={profile?.gender ?? 'm'} size={size} />
      <Text style={[styles.vs, { color: colors.goldHi }]}>VS</Text>
      <Avatar character={rival} gender="m" size={size} />
    </View>
  );
}

/** A glowing slice of a real Chart Duel price line, as a shop-window display. */
function ChartVignette({ width, height }: { width: number; height: number }) {
  const { colors, look } = useStore();
  // Inside a universe the line takes the readable accent of its look.
  const c = look.brand ? { hi: colors.goldText, mid: colors.goldText, lo: colors.goldText } : { hi: colors.goldHi, mid: colors.gold, lo: colors.goldLo };
  const base = useId().replace(/[^a-zA-Z0-9]/g, '');
  const prices = useMemo(() => generateSeries(25).prices.slice(HISTORY_TICKS - 10, HISTORY_TICKS + 150), []);
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
          <Stop offset="0" stopColor={c.lo} stopOpacity={0.4} />
          <Stop offset="0.6" stopColor={c.mid} />
          <Stop offset="1" stopColor={c.hi} />
        </LinearGradient>
        <LinearGradient id={`${base}a`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.mid} stopOpacity={0.28} />
          <Stop offset="1" stopColor={c.mid} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${base}a)`} />
      <Path d={line} fill="none" stroke={c.mid} strokeOpacity={0.18} strokeWidth={7} strokeLinejoin="round" />
      <Path d={line} fill="none" stroke={`url(#${base}s)`} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={ex - 2} cy={ey} r={9} fill={c.hi} fillOpacity={0.18} />
      <Circle cx={ex - 2} cy={ey} r={4} fill={c.hi} />
    </Svg>
  );
}

function GameTile({ game: shown, onPress, starting, playLabel }: { game: ShownGame; onPress: () => void; starting: boolean; playLabel: string }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, fmt, showMoney } = useStore();
  const [width, setWidth] = useState(0);
  const game = shown.info;
  // Before a character is chosen the games are only on display.
  const inactive = !shown.playable;
  const rate = rateText(shown, fmt, (u) => showMoney(game, u));

  return (
    <LiftPressable onPress={onPress} disabled={starting || !shown.entry} accessibilityLabel={t(game.title)}>
      <Glass style={[styles.tile, inactive && { opacity: 0.55 }]}>
        <View style={styles.vignette} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
          {width > 0 && (game.id === 'kombat' ? <KombatVignette width={width} height={128} /> : <ChartVignette width={width} height={128} />)}
        </View>
        <View style={styles.tileBody}>
          <Text style={[styles.tileTitle, { color: colors.text }]} numberOfLines={2}>
            {t(game.title)}
          </Text>
          <Text style={[tp.body, { color: colors.muted }]}>{t(game.tagline)}</Text>
          <View style={styles.meta}>
            <View style={styles.metaItem}>
              <UsersIcon color={colors.goldText} />
              <Text style={[styles.metaText, { color: colors.text }]}>{game.players}</Text>
            </View>
            {game.seconds !== null && (
              <View style={styles.metaItem}>
                <ClockIcon color={colors.goldText} />
                <Text style={[styles.metaText, { color: colors.text }]}>
                  {game.seconds} {t('unit.sec')}
                </Text>
              </View>
            )}
            {game.offline && (
              <View style={[styles.tag, { borderColor: colors.glassEdge }]}>
                <Text style={[styles.tagText, { color: colors.muted }]}>{t('hub.vsBots')}</Text>
              </View>
            )}
          </View>
          {!!rate && <Text style={[styles.rate, { color: colors.goldText }]}>{rate}</Text>}
          <Button label={playLabel} onPress={onPress} big variant={inactive ? 'glass' : 'gold'} disabled={starting || !shown.entry} />
        </View>
      </Glass>
    </LiftPressable>
  );
}

const baseStyles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: space.lg, gap: 22, paddingBottom: space.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wordmark: { flex: 1, fontFamily: fonts.display, fontSize: 34, letterSpacing: 0.3 },
  iconButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pocket: { padding: 20, gap: 18 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  balanceText: { flex: 1, minWidth: 0 },
  balanceLabel: { fontSize: 13, letterSpacing: 0.3 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  amount: { fontFamily: fonts.display, fontSize: 54, lineHeight: 60, flexShrink: 1, fontVariant: ['lining-nums'] },
  ticker: { fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  rule: { height: StyleSheet.hairlineWidth },
  playerRow: { gap: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  whoText: { flex: 1, minWidth: 0, gap: 2 },
  nick: { fontFamily: fonts.displaySemi, fontSize: 22 },
  worldLine: { fontSize: 13, lineHeight: 18 },
  charName: { fontFamily: fonts.display, fontSize: 18 },
  stats: { flexDirection: 'row', gap: space.md },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: fonts.displaySemi, fontSize: 24, lineHeight: 28, fontVariant: ['lining-nums'] },
  statLabel: { fontSize: 12 },
  sectionHead: { gap: 4, marginBottom: -8 },
  brandHeader: { marginHorizontal: -20, marginTop: -space.lg, paddingHorizontal: 20, paddingTop: space.lg, paddingBottom: 22, overflow: 'hidden' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandText: { flex: 1, gap: 2 },
  brandTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  brandSub: { fontSize: 14, fontWeight: '500' },
  brandButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  away: { opacity: 0.45 },
  country: { fontSize: 12 },
  section: { fontFamily: fonts.displaySemi, fontSize: 24 },
  chooseLink: { alignSelf: 'flex-start', marginTop: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  chooseText: { fontSize: 13, fontWeight: '700' },
  rate: { fontFamily: fonts.displaySemi, fontSize: 18, fontVariant: ['lining-nums'] },
  tile: { padding: 0 },
  vignette: { height: 128, marginTop: 8 },
  tileBody: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4, gap: 12 },
  tileTitle: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 14, fontWeight: '700' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  tagText: { fontSize: 12, fontWeight: '600' },
  soon: { padding: 20, gap: 8 },
  soonButton: { marginTop: 6 },
  versus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  vs: { fontFamily: fonts.display, fontSize: 40, letterSpacing: 1 },
  soonTitle: { fontFamily: fonts.displaySemi, fontSize: 20 },
});
