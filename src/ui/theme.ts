// Market Combat look: a boutique at night.
//
// Layout concept: content floats on near-black with a warm light rising from
// below, like a shop window after closing. Panels are smoked glass with a
// thin gold edge; the ABIE coin and the main buttons are the only solid gold.
// Green and red appear only for price direction (long / short, profit / loss).
//
// Type: Cormorant Garamond (display: wordmark, balances, titles) over the
// system sans for everything you read in running text.

export type ThemeMode = 'system' | 'dark' | 'light';
export type Scheme = 'dark' | 'light';

export interface Colors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  /** Smoked glass panel fill, its gold edge and the light on its top edge. */
  glass: string;
  glassEdge: string;
  glassHighlight: string;
  /** Warm light rising from the bottom of the screen; tinted by the character's world. */
  glow: string;
  /** Colour of the character's world (outfit, world name). Gold before a character is chosen. */
  world: string;
  gold: string;
  goldHi: string;
  goldLo: string;
  goldInk: string;
  goldSoft: string;
  coinInk: string;
  up: string;
  upSoft: string;
  down: string;
  downSoft: string;
  onSide: string;
  news: string;
  newsInk: string;
}

export const PALETTES: Record<Scheme, Colors> = {
  dark: {
    bg: '#090705',
    surface: '#15110C',
    surfaceAlt: '#1E1810',
    line: '#3A2F20',
    text: '#F6EEDF',
    muted: '#B4A68F',
    faint: '#7D705C',
    glass: 'rgba(255, 236, 200, 0.045)',
    glassEdge: 'rgba(226, 184, 101, 0.30)',
    glassHighlight: 'rgba(255, 233, 186, 0.10)',
    glow: '#C8862C',
    world: '#E2B865',
    gold: '#E2B865',
    goldHi: '#F8DFA0',
    goldLo: '#A9792C',
    goldInk: '#1B1205',
    goldSoft: 'rgba(226, 184, 101, 0.12)',
    coinInk: '#3A2706',
    up: '#3DD598',
    upSoft: 'rgba(61, 213, 152, 0.14)',
    down: '#FF6B7D',
    downSoft: 'rgba(255, 107, 125, 0.14)',
    onSide: '#090705',
    news: '#F8DFA0',
    newsInk: '#1B1205',
  },
  light: {
    bg: '#F3EDE3',
    surface: '#FFFCF6',
    surfaceAlt: '#F7F0E4',
    line: '#E2D5BF',
    text: '#1C150C',
    muted: '#6A5B45',
    faint: '#A2937B',
    glass: 'rgba(255, 252, 245, 0.72)',
    glassEdge: 'rgba(169, 121, 44, 0.32)',
    glassHighlight: 'rgba(255, 255, 255, 0.9)',
    glow: '#E7B866',
    world: '#AE7F2B',
    gold: '#AE7F2B',
    goldHi: '#E9C77D',
    goldLo: '#8A6120',
    goldInk: '#FFFDF7',
    goldSoft: 'rgba(174, 127, 43, 0.10)',
    coinInk: '#FFF5DD',
    up: '#0F8F5F',
    upSoft: 'rgba(15, 143, 95, 0.10)',
    down: '#C93A4F',
    downSoft: 'rgba(201, 58, 79, 0.10)',
    onSide: '#FFFFFF',
    news: '#F8DFA0',
    newsInk: '#1B1205',
  },
};

/** Base palette with the world of the player's character laid over it. */
export function paletteFor(scheme: Scheme, world?: { glow: Record<Scheme, string>; colorLight: string; colorDeep: string } | null): Colors {
  const base = PALETTES[scheme];
  if (!world) return base;
  return { ...base, glow: world.glow[scheme], world: scheme === 'dark' ? world.colorLight : world.colorDeep };
}

export const fonts = {
  /** Loaded in App.tsx; the names must match the keys passed to useFonts. */
  display: 'CormorantGaramond-Bold',
  displaySemi: 'CormorantGaramond-SemiBold',
};

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const type = {
  display: { fontSize: 32, fontFamily: fonts.display, letterSpacing: 0.2 },
  title: { fontSize: 22, fontFamily: fonts.displaySemi },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 17, fontFamily: fonts.displaySemi, letterSpacing: 0.2 },
  num: { fontVariant: ['tabular-nums' as const] },
};
