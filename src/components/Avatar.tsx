// The four characters as small portrait busts, man or woman, in the
// night-boutique style: dark round frame with a thin gold ring, the world's
// colour in the outfit and in the light behind them, and one tool of the trade.
// Original drawings; no marketplace logos.

import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { CharacterId, Gender } from '../api/contract';
import { useStore } from '../state/store';
import { CHARACTERS } from '../world/characters';

const SKIN = '#E7B48C';
const SKIN_SHADE = '#C98E66';
const HAIR = { m: '#2B1E16', f: '#4A2A18' };
const DARK = '#1B1714';

export function Avatar({ character, gender, size = 96, ring = true }: { character: CharacterId; gender: Gender; size?: number; ring?: boolean }) {
  const { colors } = useStore();
  const c = CHARACTERS[character];
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `${name}${raw}`;
  const f = gender === 'f';

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <RadialGradient id={id('bg')} cx="60" cy="40" r="80" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#241C15" />
            <Stop offset="1" stopColor="#0B0806" />
          </RadialGradient>
          <RadialGradient id={id('glow')} cx="60" cy="122" r="62" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={c.color} stopOpacity={0.75} />
            <Stop offset="1" stopColor={c.color} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id={id('cloth')} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.colorLight} />
            <Stop offset="0.45" stopColor={c.color} />
            <Stop offset="1" stopColor={c.colorDeep} />
          </LinearGradient>
          <LinearGradient id={id('skin')} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F1C39C" />
            <Stop offset="1" stopColor={SKIN} />
          </LinearGradient>
          <LinearGradient id={id('gold')} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.goldHi} />
            <Stop offset="1" stopColor={colors.goldLo} />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="120" height="120" fill={`url(#${id('bg')})`} />
        <Rect x="0" y="40" width="120" height="80" fill={`url(#${id('glow')})`} />

        {/* Long hair falls behind the shoulders. */}
        {f && (
          <Path
            d="M36 52 C33 30 45 21 60 21 C75 21 87 30 84 52 L86 84 C81 91 74 89 72 82 L71 58 L49 58 L48 82 C46 89 39 91 34 84 Z"
            fill={HAIR.f}
          />
        )}

        {/* Body. */}
        <Path d="M16 122 C18 99 37 86 60 86 C83 86 102 99 104 122 Z" fill={`url(#${id('cloth')})`} />
        {f ? (
          <Path d="M47 87 Q60 101 73 87" fill="none" stroke={`url(#${id('gold')})`} strokeWidth={1.6} strokeLinecap="round" />
        ) : (
          <Path d="M49 87 L60 101 L71 87" fill="none" stroke={`url(#${id('gold')})`} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Neck and head. */}
        <Path d="M52.5 70 H67.5 V87 Q60 93 52.5 87 Z" fill={SKIN_SHADE} />
        <Ellipse cx="40.5" cy="55" rx="3.2" ry="5.2" fill={SKIN_SHADE} />
        <Ellipse cx="79.5" cy="55" rx="3.2" ry="5.2" fill={SKIN_SHADE} />
        <Ellipse cx="60" cy="53" rx="20" ry="23" fill={`url(#${id('skin')})`} />

        {/* Face. */}
        {f ? (
          <G>
            <Path d="M49 47.5 Q53 45.5 57 47.2" fill="none" stroke={HAIR.f} strokeWidth={1.3} strokeLinecap="round" />
            <Path d="M63 47.2 Q67 45.5 71 47.5" fill="none" stroke={HAIR.f} strokeWidth={1.3} strokeLinecap="round" />
            <Circle cx="48.5" cy="62" r="3.2" fill="#E58C7E" fillOpacity={0.35} />
            <Circle cx="71.5" cy="62" r="3.2" fill="#E58C7E" fillOpacity={0.35} />
            <Path d="M55 64.5 Q60 68.5 65 64.5" fill="none" stroke="#B5525A" strokeWidth={2} strokeLinecap="round" />
          </G>
        ) : (
          <G>
            <Path d="M48.5 47 Q53 44.8 57.5 46.6" fill="none" stroke={HAIR.m} strokeWidth={2.2} strokeLinecap="round" />
            <Path d="M62.5 46.6 Q67 44.8 71.5 47" fill="none" stroke={HAIR.m} strokeWidth={2.2} strokeLinecap="round" />
            <Path d="M54.5 65 Q60 69 65.5 65" fill="none" stroke="#7A3E2A" strokeWidth={1.9} strokeLinecap="round" />
          </G>
        )}
        <Ellipse cx="53" cy="54" rx="2.3" ry="2.7" fill="#2A1B12" />
        <Ellipse cx="67" cy="54" rx="2.3" ry="2.7" fill="#2A1B12" />
        <Circle cx="53.8" cy="53" r="0.8" fill="#FFFFFF" />
        <Circle cx="67.8" cy="53" r="0.8" fill="#FFFFFF" />

        {/* Hair in front. */}
        {f ? (
          <Path d="M39 51 C38 32 48 25 60 25 C72 25 82 32 81 51 C76 42 70 38 62 39 C56 43 47 46 39 51 Z" fill={HAIR.f} />
        ) : (
          <Path d="M40 49 C40 32 50 27 60 27 C71 27 81 33 80 48 C76 40 69 37 60 38 C51 38 44 41 40 49 Z" fill={HAIR.m} />
        )}

        <Gear character={character} cloth={`url(#${id('cloth')})`} c={c} gold={`url(#${id('gold')})`} />

        {/* Tool of the trade, in a small gold-rimmed medallion. */}
        <Circle cx="95" cy="95" r="14" fill="#120E0A" stroke={`url(#${id('gold')})`} strokeWidth={1.5} />
        <Tool character={character} gold={colors.goldHi} />

        {ring && <Circle cx="60" cy="60" r="58.8" fill="none" stroke={`url(#${id('gold')})`} strokeWidth={1.6} />}
      </Svg>
    </View>
  );
}

/** Headwear: cap, headset, beanie or helmet. */
function Gear({ character, cloth, c, gold }: { character: CharacterId; cloth: string; c: (typeof CHARACTERS)[CharacterId]; gold: string }) {
  switch (character) {
    case 'valdberik':
      return (
        <G>
          <Path d="M38 42 C38 25 49 19 60 19 C72 19 82 25 82 42 Z" fill={cloth} />
          <Path d="M40 42 Q60 48 80 42 L82 45.5 Q60 52 38 45.5 Z" fill={c.colorDeep} />
          <Circle cx="60" cy="20" r="2" fill={gold} />
          <Path d="M60 27 L62 31 L60 35 L58 31 Z" fill={gold} />
        </G>
      );
    case 'ozonik':
      return (
        <G>
          <Path d="M37 53 C37 23 83 23 83 53" fill="none" stroke={DARK} strokeWidth={4.5} strokeLinecap="round" />
          <Path d="M38.5 50 C38.5 26.5 81.5 26.5 81.5 50" fill="none" stroke={c.colorLight} strokeWidth={1.2} strokeLinecap="round" />
          <Rect x="31" y="46" width="10" height="17" rx="4.5" fill={c.colorDeep} stroke={gold} strokeWidth={1.2} />
          <Rect x="79" y="46" width="10" height="17" rx="4.5" fill={c.colorDeep} stroke={gold} strokeWidth={1.2} />
          <Path d="M37 62 Q41 72 51 71" fill="none" stroke={DARK} strokeWidth={2.4} strokeLinecap="round" />
          <Circle cx="52.5" cy="71" r="2.6" fill={c.colorLight} />
        </G>
      );
    case 'avitos':
      return (
        <G>
          <Path d="M38 46 C38 26 49 19 60 19 C71 19 82 26 82 46 Z" fill={cloth} />
          <Path d="M47 25 V44 M53.5 21.5 V44 M60 20.5 V44 M66.5 21.5 V44 M73 25 V44" stroke={c.colorDeep} strokeOpacity={0.45} strokeWidth={1.2} />
          <Rect x="35" y="40" width="50" height="9" rx="4" fill={c.colorDeep} />
          <Circle cx="60" cy="17" r="5.5" fill={c.colorLight} />
        </G>
      );
    case 'yandos':
      return (
        <G>
          <Path d="M36 46 C36 23 48 15 60 15 C72 15 84 23 84 46 Z" fill={cloth} />
          <Path d="M60 15.5 V45" stroke={c.colorDeep} strokeWidth={3} />
          <Path d="M45 24 L49 32 M75 24 L71 32" stroke={c.colorDeep} strokeWidth={2} strokeLinecap="round" />
          <Rect x="37" y="44" width="46" height="5" rx="2.5" fill={DARK} />
        </G>
      );
  }
}

/** Small gold icon in the medallion. */
function Tool({ character, gold }: { character: CharacterId; gold: string }) {
  switch (character) {
    case 'valdberik': // parcel
      return (
        <G>
          <Path d="M87 91 L95 87 L103 91 L103 100 L95 104 L87 100 Z" fill="none" stroke={gold} strokeWidth={1.6} strokeLinejoin="round" />
          <Path d="M87 91 L95 95 L103 91 M95 95 V104" fill="none" stroke={gold} strokeWidth={1.4} strokeLinejoin="round" />
        </G>
      );
    case 'ozonik': // barcode
      return <Path d="M88 89 V101 M90.5 89 V101 M93.5 89 V101 M95.5 89 V101 M98.5 89 V101 M101.5 89 V101" stroke={gold} strokeWidth={1.4} />;
    case 'avitos': // price tag
      return (
        <G>
          <Path d="M88 95 L95 88 L102.5 88 L102.5 95.5 L95.5 102.5 Z" fill="none" stroke={gold} strokeWidth={1.6} strokeLinejoin="round" />
          <Circle cx="99" cy="91.5" r="1.4" fill={gold} />
        </G>
      );
    case 'yandos': // map pin
      return (
        <G>
          <Path d="M95 104 C90 98 88.5 95 88.5 92.5 A6.5 6.5 0 0 1 101.5 92.5 C101.5 95 100 98 95 104 Z" fill="none" stroke={gold} strokeWidth={1.6} strokeLinejoin="round" />
          <Circle cx="95" cy="92.5" r="2.2" fill={gold} />
        </G>
      );
  }
}
