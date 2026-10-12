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
  /**
   * Accent of the look: gold in the neutral cabinet, the universe's own
   * colour inside a universe. gold/goldHi/goldLo fill the main buttons,
   * goldText is the accent for text and icons, goldInk the text on a fill.
   */
  gold: string;
  goldHi: string;
  goldLo: string;
  goldInk: string;
  goldSoft: string;
  goldText: string;
  /** The ABIE coin stays gold in every look. */
  coin: string;
  coinHi: string;
  coinLo: string;
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
    goldText: '#E2B865',
    coin: '#E2B865',
    coinHi: '#F8DFA0',
    coinLo: '#A9792C',
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
    goldText: '#AE7F2B',
    coin: '#C99A45',
    coinHi: '#E9C77D',
    coinLo: '#8A6120',
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

// ------------------------------------------------------------------ looks
//
// Outside a universe the player is in the neutral cabinet: the night
// boutique above, dark or light as the settings say. Inside a universe the
// whole app takes the look of that marketplace's own app: its colours, a
// branded header, flat or gradient buttons, its corners and a plain sans
// type. A universe look has no dark or light switch: it is what it is.

export type LookId = 'neutral' | 'waldberik' | 'ozonik' | 'avitos' | 'yandos';

export interface Shape {
  card: number;
  button: number;
  buttonBig: number;
  small: number;
}

export interface Look {
  id: LookId;
  /** A universe look (not the neutral night boutique). */
  brand: boolean;
  scheme: Scheme;
  colors: Colors;
  shape: Shape;
  /** Branded header on top of the main screen and behind the status bar. */
  header: { from: string; to: string; ink: string; sub: string } | null;
  statusBar: 'light' | 'dark';
  /** Main buttons with a gradient (or flat). */
  buttonGradient: boolean;
  /** Cards with a soft shadow (or flat). */
  cardShadow: boolean;
  /** Display text size factor: the system sans looks larger than Cormorant at the same size. */
  scale: number;
}

const NEUTRAL_SHAPE: Shape = { card: 22, button: 14, buttonBig: 22, small: 8 };

const brand = (colors: Omit<Colors, 'coin' | 'coinHi' | 'coinLo' | 'coinInk' | 'onSide' | 'glassHighlight'>): Colors => ({
  ...colors,
  glassHighlight: 'rgba(255, 255, 255, 0)',
  onSide: '#FFFFFF',
  coin: '#E2B865',
  coinHi: '#F8DFA0',
  coinLo: '#A9792C',
  coinInk: '#3A2706',
});

export const UNIVERSE_LOOKS: Record<Exclude<LookId, 'neutral'>, Omit<Look, 'id'>> = {
  // Waldberik: magenta-to-purple header and buttons, white rounded cards on a lilac-grey ground.
  waldberik: {
    brand: true,
    scheme: 'light',
    colors: brand({
      bg: '#F6F4F8',
      surface: '#FFFFFF',
      surfaceAlt: '#F1EDF5',
      line: '#E7E1EE',
      text: '#1B1523',
      muted: '#6E6579',
      faint: '#A39BAE',
      glass: '#FFFFFF',
      glassEdge: '#EEE8F3',
      glow: '#CB11AB',
      world: '#A3159F',
      gold: '#B513AE',
      goldHi: '#D41CB2',
      goldLo: '#6E1A9F',
      goldInk: '#FFFFFF',
      goldSoft: 'rgba(203, 17, 171, 0.09)',
      goldText: '#B513AE',
      up: '#11A35B',
      upSoft: 'rgba(17, 163, 91, 0.10)',
      down: '#E5303D',
      downSoft: 'rgba(229, 48, 61, 0.10)',
      news: '#FBE3F5',
      newsInk: '#1B1523',
    }),
    shape: { card: 20, button: 14, buttonBig: 16, small: 12 },
    header: { from: '#CB11AB', to: '#481173', ink: '#FFFFFF', sub: 'rgba(255, 255, 255, 0.82)' },
    statusBar: 'light',
    buttonGradient: true,
    cardShadow: true,
    scale: 0.78,
  },
  // Ozonik: bright blue, flat white cards with small corners on a cool grey ground, pink accents.
  ozonik: {
    brand: true,
    scheme: 'light',
    colors: brand({
      bg: '#F2F3F7',
      surface: '#FFFFFF',
      surfaceAlt: '#EEF1F6',
      line: '#E1E5EC',
      text: '#001A34',
      muted: '#5A6B7D',
      faint: '#99A3AE',
      glass: '#FFFFFF',
      glassEdge: '#FFFFFF',
      glow: '#005BFF',
      world: '#005BFF',
      gold: '#005BFF',
      goldHi: '#005BFF',
      goldLo: '#005BFF',
      goldInk: '#FFFFFF',
      goldSoft: 'rgba(0, 91, 255, 0.08)',
      goldText: '#005BFF',
      up: '#10C44C',
      upSoft: 'rgba(16, 196, 76, 0.10)',
      down: '#F91155',
      downSoft: 'rgba(249, 17, 85, 0.09)',
      news: '#F91155',
      newsInk: '#FFFFFF',
    }),
    shape: { card: 12, button: 10, buttonBig: 12, small: 8 },
    header: { from: '#005BFF', to: '#0047D6', ink: '#FFFFFF', sub: 'rgba(255, 255, 255, 0.82)' },
    statusBar: 'light',
    buttonGradient: false,
    cardShadow: false,
    scale: 0.76,
  },
  // Avitos: white and airy, light grey cards without borders, black type, sky-blue buttons.
  avitos: {
    brand: true,
    scheme: 'light',
    colors: brand({
      bg: '#FFFFFF',
      surface: '#F4F4F4',
      surfaceAlt: '#EFEFEF',
      line: '#E8E8E8',
      text: '#000000',
      muted: '#757575',
      faint: '#A8A8A8',
      glass: '#F2F2F2',
      glassEdge: '#F2F2F2',
      glow: '#00AAFF',
      world: '#0099F7',
      gold: '#00AAFF',
      goldHi: '#00AAFF',
      goldLo: '#00AAFF',
      goldInk: '#FFFFFF',
      goldSoft: 'rgba(0, 170, 255, 0.10)',
      goldText: '#0091E0',
      up: '#2BB24C',
      upSoft: 'rgba(43, 178, 76, 0.10)',
      down: '#FF4053',
      downSoft: 'rgba(255, 64, 83, 0.09)',
      news: '#A169F7',
      newsInk: '#FFFFFF',
    }),
    shape: { card: 16, button: 12, buttonBig: 12, small: 10 },
    header: { from: '#FFFFFF', to: '#FFFFFF', ink: '#000000', sub: '#757575' },
    statusBar: 'dark',
    buttonGradient: false,
    cardShadow: false,
    scale: 0.76,
  },
  // Yandos: sunny yellow header and buttons with black type, big round corners on a warm grey ground.
  yandos: {
    brand: true,
    scheme: 'light',
    colors: brand({
      bg: '#F5F4F2',
      surface: '#FFFFFF',
      surfaceAlt: '#F0EEEA',
      line: '#E6E3DD',
      text: '#21201F',
      muted: '#6F6D69',
      faint: '#A8A5A0',
      glass: '#FFFFFF',
      glassEdge: '#EEEBE6',
      glow: '#FFDD2D',
      world: '#8F6B00',
      gold: '#FFDD2D',
      goldHi: '#FFDD2D',
      goldLo: '#FFDD2D',
      goldInk: '#000000',
      goldSoft: 'rgba(255, 221, 45, 0.28)',
      goldText: '#7A5E00',
      up: '#1BA548',
      upSoft: 'rgba(27, 165, 72, 0.10)',
      down: '#FC3F1D',
      downSoft: 'rgba(252, 63, 29, 0.09)',
      news: '#FFDD2D',
      newsInk: '#000000',
    }),
    shape: { card: 24, button: 16, buttonBig: 18, small: 12 },
    header: { from: '#FFDD2D', to: '#FFD21F', ink: '#000000', sub: 'rgba(0, 0, 0, 0.62)' },
    statusBar: 'dark',
    buttonGradient: false,
    cardShadow: true,
    scale: 0.76,
  },
};

/** The look for the player: their universe's while inside it, the night boutique otherwise. */
export function lookFor(scheme: Scheme, universe: Exclude<LookId, 'neutral'> | null): Look {
  if (universe) return { id: universe, ...UNIVERSE_LOOKS[universe] };
  return {
    id: 'neutral',
    brand: false,
    scheme,
    colors: PALETTES[scheme],
    shape: NEUTRAL_SHAPE,
    header: null,
    statusBar: scheme === 'dark' ? 'light' : 'dark',
    buttonGradient: true,
    cardShadow: true,
    scale: 1,
  };
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
