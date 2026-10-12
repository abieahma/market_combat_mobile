// Market Kombat cards: the suit marks of the four universes, the card faces
// and the texts that say what a card does. Original shapes; no logos.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { KOMBAT_JOKER } from '../api/contract';
import type { CharacterId, KombatCardId } from '../api/contract';
import { CardDef, cardDef, KOMBAT_POISON_TURNS, KOMBAT_SHIELD_TURNS, scaled } from '../game/kombat';
import { StringKey } from '../i18n/strings';
import { useStore } from '../state/store';
import { CHARACTERS } from '../world/characters';

type T = (key: StringKey) => string;
type TF = (key: StringKey, vars: Record<string, string | number>) => string;

const INK = '#1B1714';
const GOLD = '#C9973B';

/** The mark of a suit: a parcel, a hub ring, a price tag, a map pin. */
export function SuitGlyph({ suit, size = 18 }: { suit: CharacterId; size?: number }) {
  const c = CHARACTERS[suit];
  const stroke = { stroke: c.colorDeep, strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {suit === 'waldberik' && (
        <>
          <Path d="M3.5 7.5 L12 3.5 L20.5 7.5 V16.5 L12 20.5 L3.5 16.5 Z" fill={c.color} {...stroke} />
          <Path d="M3.5 7.5 L12 11.5 L20.5 7.5 M12 11.5 V20.5" fill="none" stroke="#FFFFFF" strokeOpacity={0.85} strokeWidth={1.6} />
        </>
      )}
      {suit === 'ozonik' && (
        <>
          <Circle cx={12} cy={12} r={7.5} fill="none" stroke={c.color} strokeWidth={4.2} />
          <Circle cx={12} cy={12} r={9.6} fill="none" stroke={c.colorDeep} strokeWidth={0.9} />
          <Circle cx={12} cy={12} r={2.6} fill={c.colorDeep} />
        </>
      )}
      {suit === 'avitos' && (
        <>
          <Path d="M3 12.5 L11.5 4 H20 V12.5 L11.5 21 Z" fill={c.color} {...stroke} />
          <Circle cx={15.8} cy={8.2} r={1.8} fill="#FFFFFF" />
        </>
      )}
      {suit === 'yandos' && (
        <>
          <Path d="M12 21.5 C12 21.5 4.8 14.6 4.8 9.6 A7.2 7.2 0 0 1 19.2 9.6 C19.2 14.6 12 21.5 12 21.5 Z" fill={c.color} {...stroke} />
          <Circle cx={12} cy={9.6} r={2.7} fill="#FFFFFF" stroke={c.colorDeep} strokeWidth={1} />
        </>
      )}
    </Svg>
  );
}

/** What kind of card it is, as a small sign. */
export function KindIcon({ def, size = 14, color = INK }: { def: CardDef | null; size?: number; color?: string }) {
  const k = def?.kind ?? 'joker';
  const shieldPath = 'M12 3 L19 6 V11 C19 16 15.5 19.5 12 21 C8.5 19.5 5 16 5 11 V6 Z';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {k === 'attack' && <Path d="M15 3.5 H20.5 V9 L10.5 19 L7 15.5 Z M4 16.5 L7.5 20 M3.5 20.5 L5.5 18.5" fill={color} stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
      {k === 'defense' && <Path d={shieldPath} fill={color} />}
      {k === 'boost' && <Path d="M6 12.5 L12 6.5 L18 12.5 M6 18.5 L12 12.5 L18 18.5" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />}
      {k === 'queen' && def?.heal ? (
        <Path d="M12 20 C5.5 15.2 3 11.6 3 8.6 A4.4 4.4 0 0 1 12 6.6 A4.4 4.4 0 0 1 21 8.6 C21 11.6 18.5 15.2 12 20 Z" fill={color} />
      ) : null}
      {k === 'queen' && !def?.heal ? (
        <>
          <Path d={shieldPath} fill="none" stroke={color} strokeWidth={2} />
          <Path d="M12 8 V16 M8 12 H16" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : null}
      {k === 'king' && <Path d="M3 18.5 L4.8 7.5 L9.5 12 L12 5.5 L14.5 12 L19.2 7.5 L21 18.5 Z" fill={color} />}
      {(k === 'ace' || k === 'joker') && <Path d="M12 2.5 L14.6 8.7 L21.4 9.3 L16.2 13.7 L17.8 20.4 L12 16.8 L6.2 20.4 L7.8 13.7 L2.6 9.3 L9.4 8.7 Z" fill={k === 'joker' ? GOLD : color} />}
    </Svg>
  );
}

export function EnergyIcon({ size = 12, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M13.5 2 L4.5 13.5 H11 L10 22 L19.5 9.5 H13 Z" fill={color} />
    </Svg>
  );
}

// ------------------------------------------------------------------- texts

export function cardRank(id: KombatCardId): string {
  return id === KOMBAT_JOKER ? '★' : id.slice(id.lastIndexOf('-') + 1);
}

export function cardName(id: KombatCardId, t: T): string {
  if (id === KOMBAT_JOKER) return t('card.joker');
  const d = cardDef(id);
  if (d.kind === 'attack') return t(`card.atk${d.rank}` as StringKey);
  if (d.kind === 'defense') return t(`card.def${d.rank}` as StringKey);
  if (d.kind === 'boost') return t('card.J');
  return t(`card.${d.rank}.${d.suit}` as StringKey);
}

/** What a card does for a fighter of `owner` (own-suit cards count stronger). */
export function cardEffects(id: KombatCardId, owner: CharacterId | null, t: T, tf: TF): string[] {
  if (id === KOMBAT_JOKER) return [t('fx.joker')];
  const d = owner ? scaled(cardDef(id), owner) : cardDef(id);
  const out: string[] = [];
  if (d.damage) out.push(tf('fx.damage', { n: d.damage }));
  if (d.pierce) out.push(t('fx.pierce'));
  if (d.absorb) out.push(tf('fx.absorb', { n: d.absorb }));
  if (d.counter) out.push(tf('fx.counter', { n: d.counter }));
  if (d.combo) out.push(tf('fx.combo', { n: d.combo }));
  if (d.heal) out.push(tf('fx.heal', { n: d.heal }));
  if (d.shield) out.push(tf('fx.shield', { n: d.shield, turns: KOMBAT_SHIELD_TURNS }));
  if (d.stun) out.push(t('fx.stun'));
  if (d.poison) out.push(tf('fx.poison', { n: d.poison, turns: KOMBAT_POISON_TURNS }));
  if (d.steal) out.push(tf('fx.steal', { n: d.steal }));
  if (d.stun || d.poison || d.steal) out.push(t('fx.ifHit'));
  if (d.kind === 'boost') out.push(t('fx.boostRisk'));
  return out;
}

// ------------------------------------------------------------------- faces

export type CardSize = 'hand' | 'table' | 'mini';

/**
 * A card face. `width` sets the size; the height follows the card shape.
 * The joker shows the card it became (`as`) with a star in the corner.
 */
export function KombatCard({
  card,
  as,
  owner,
  width,
  selected,
  dim,
  faceDown,
  onPress,
  label,
}: {
  card: KombatCardId;
  as?: KombatCardId | null;
  owner: CharacterId | null;
  width: number;
  selected?: boolean;
  dim?: boolean;
  faceDown?: boolean;
  onPress?: () => void;
  label?: string;
}) {
  const { colors, scheme, t } = useStore();
  const height = Math.round(width * 1.42);
  const face = scheme === 'dark' ? '#F4ECDD' : '#FFFFFF';
  const shown = card === KOMBAT_JOKER ? (as ?? null) : card;
  const def = shown ? cardDef(shown) : null;
  const suit = def ? CHARACTERS[def.suit] : null;
  const own = !!def && !!owner && def.suit === owner;
  const big = width >= 70;
  const rankSize = Math.round(width * (big ? 0.27 : 0.3));

  const body = faceDown ? (
    <View style={[styles.card, styles.back, { width, height, borderColor: colors.gold, backgroundColor: scheme === 'dark' ? '#2A211A' : '#3A2E25' }]}>
      <View style={[styles.backInner, { borderColor: colors.gold }]}>
        <Text style={[styles.backMark, { color: colors.gold, fontSize: Math.round(width * 0.24) }]}>MK</Text>
      </View>
    </View>
  ) : (
    <View
      style={[
        styles.card,
        {
          width,
          height,
          backgroundColor: card === KOMBAT_JOKER && !def ? '#FFF6E2' : face,
          borderColor: selected ? colors.gold : suit ? suit.color : GOLD,
          borderWidth: selected ? 2.5 : 1.5,
        },
      ]}
    >
      {def && suit ? (
        <>
          <View style={[styles.band, { backgroundColor: suit.color, opacity: 0.16 }]} />
          <View style={styles.top}>
            <Text style={[styles.rank, { color: suit.colorDeep, fontSize: rankSize, lineHeight: rankSize + 2 }]}>{def.rank}</Text>
            <View style={styles.cost}>
              <EnergyIcon size={big ? 12 : 10} color={def.cost ? '#B07A12' : '#8A7F72'} />
              <Text style={[styles.costText, { fontSize: big ? 12 : 10, color: INK }]}>{def.cost}</Text>
            </View>
          </View>
          <View style={styles.center}>
            <SuitGlyph suit={def.suit} size={Math.round(width * 0.42)} />
          </View>
          <View style={styles.bottom}>
            <KindIcon def={def} size={Math.round(width * (big ? 0.2 : 0.22))} color={suit.colorDeep} />
            {own && <Text style={[styles.own, { color: '#B07A12', fontSize: big ? 11 : 9 }]}>+25%</Text>}
          </View>
          {card === KOMBAT_JOKER && (
            <View style={[styles.jokerBadge, { backgroundColor: GOLD }]}>
              <Text style={styles.jokerBadgeText}>★</Text>
            </View>
          )}
        </>
      ) : (
        <View style={styles.jokerFace}>
          <KindIcon def={null} size={Math.round(width * 0.5)} />
          <Text style={[styles.jokerText, { fontSize: big ? 12 : 9 }]} numberOfLines={1} adjustsFontSizeToFit>
            {t('card.joker').toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ opacity: dim ? 0.42 : 1, transform: [{ translateY: selected ? -8 : 0 }] }}>
      {onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={label ?? (shown ? cardName(shown, t) : t('card.joker'))} accessibilityState={{ selected: !!selected }} onPress={onPress}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

/** A card in a line of text: rank and suit mark. */
export function CardChip({ card, as }: { card: KombatCardId; as?: KombatCardId }) {
  const { scheme } = useStore();
  const shown = card === KOMBAT_JOKER ? (as ?? null) : card;
  const def = shown ? cardDef(shown) : null;
  const suit = def ? CHARACTERS[def.suit] : null;
  return (
    <View style={[styles.chip, { backgroundColor: scheme === 'dark' ? '#F4ECDD' : '#FFFFFF', borderColor: suit ? suit.color : GOLD }]}>
      <Text style={[styles.chipRank, { color: suit ? suit.colorDeep : '#9A6B12' }]}>{def ? def.rank : '★'}</Text>
      {def && <SuitGlyph suit={def.suit} size={12} />}
      {card === KOMBAT_JOKER && def && <Text style={[styles.chipRank, { color: '#9A6B12' }]}>★</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1.5, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 4, justifyContent: 'space-between' },
  band: { position: 'absolute', left: 0, right: 0, top: 0, height: '34%' },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  rank: { fontWeight: '900', letterSpacing: -0.5 },
  cost: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 2 },
  costText: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 14 },
  own: { fontWeight: '900' },
  jokerBadge: { position: 'absolute', left: 3, top: '42%', width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  jokerBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', lineHeight: 12 },
  jokerFace: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  jokerText: { fontWeight: '900', letterSpacing: 1, color: '#9A6B12' },
  back: { alignItems: 'center', justifyContent: 'center', padding: 5 },
  backInner: { flex: 1, alignSelf: 'stretch', borderWidth: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center', opacity: 0.85 },
  backMark: { fontWeight: '900', letterSpacing: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 1, borderRadius: 5, paddingHorizontal: 4, height: 22, minWidth: 42 },
  chipRank: { fontSize: 12, fontWeight: '900' },
});
