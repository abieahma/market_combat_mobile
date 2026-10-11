import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sparkline } from '../components/PriceChart';
import { generateSeries, HISTORY_TICKS } from '../game/duel';
import { GameId, GAMES, GameInfo } from '../games';
import { useStore } from '../state/store';
import { CandlesIcon, ClockIcon, SlidersIcon, UsersIcon } from '../ui/icons';
import { BalancePill, Button, SectionLabel } from '../ui/kit';
import { radius, space, type } from '../ui/theme';

export function HubScreen({ onPlay, onSettings }: { onPlay: (id: GameId) => void; onSettings: () => void }) {
  const { colors, t, profile, fmt, haptic } = useStore();

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.wordTop, { color: colors.gold }]}>MARKET</Text>
          <Text style={[styles.wordBottom, { color: colors.text }]}>COMBAT</Text>
        </View>
        <BalancePill />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.settings')}
          hitSlop={10}
          onPress={() => {
            haptic('tap');
            onSettings();
          }}
          style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
        >
          <SlidersIcon color={colors.text} />
        </Pressable>
      </View>

      <View style={[styles.profile, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.nick, { color: colors.text }]} numberOfLines={1}>
          {profile.nickname}
        </Text>
        <View style={styles.stats}>
          <Stat label={t('stats.matches')} value={fmt(profile.matches)} />
          <Stat label={t('stats.wins')} value={fmt(profile.wins)} />
          <Stat label={t('stats.earned')} value={fmt(profile.earned)} gold />
        </View>
      </View>

      <SectionLabel>{t('hub.games')}</SectionLabel>

      {GAMES.map((g) => (
        <GameCard key={g.id} game={g} onPlay={() => onPlay(g.id)} />
      ))}

      <View style={[styles.soon, { borderColor: colors.line }]}>
        <Text style={[styles.soonTitle, { color: colors.text }]}>{t('hub.soonTitle')}</Text>
        <Text style={[type.body, { color: colors.muted }]}>{t('hub.soonText')}</Text>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  const { colors } = useStore();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, type.num, { color: gold ? colors.gold : colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function GameCard({ game, onPlay }: { game: GameInfo; onPlay: () => void }) {
  const { colors, t } = useStore();
  const [width, setWidth] = useState(0);
  const preview = useMemo(() => generateSeries(20261011).prices.slice(HISTORY_TICKS - 20, HISTORY_TICKS + 140), []);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.cardHead}>
        <View style={[styles.cardBadge, { backgroundColor: colors.surfaceAlt }]}>
          <CandlesIcon color={colors.gold} up={colors.up} down={colors.down} size={22} />
        </View>
        <Text style={[type.title, { color: colors.text, flex: 1 }]} numberOfLines={2}>
          {t(game.title)}
        </Text>
      </View>

      <View style={styles.spark} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {width > 0 && <Sparkline prices={preview} width={width} height={64} color={colors.up} />}
      </View>

      <Text style={[type.body, { color: colors.muted }]}>{t(game.tagline)}</Text>

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <UsersIcon color={colors.muted} />
          <Text style={[styles.metaText, { color: colors.text }]}>{game.players}</Text>
        </View>
        <View style={styles.metaItem}>
          <ClockIcon color={colors.muted} />
          <Text style={[styles.metaText, { color: colors.text }]}>
            {game.seconds} {t('unit.sec')}
          </Text>
        </View>
        {game.offline && (
          <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.tagText, { color: colors.muted }]}>{t('hub.vsBots')}</Text>
          </View>
        )}
      </View>

      <Button label={t('hub.play')} onPress={onPlay} big />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wordTop: { fontSize: 12, fontWeight: '800', letterSpacing: 4 },
  wordBottom: { fontSize: 30, fontWeight: '900', letterSpacing: 1, marginTop: -2 },
  iconButton: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  profile: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  nick: { fontSize: 17, fontWeight: '700' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 12 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardBadge: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  tagText: { fontSize: 11, fontWeight: '700' },
  spark: { height: 64 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 14, fontWeight: '700' },
  soon: { borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', padding: space.lg, gap: space.xs },
  soonTitle: { fontSize: 16, fontWeight: '700' },
});
