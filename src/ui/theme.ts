// Market Combat look: a night trading floor. Ink-blue surfaces, ABIE gold
// for the coin and the main call to action, green/red only for price
// direction (long / short, profit / loss).

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
  gold: string;
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
    bg: '#0B1020',
    surface: '#141B2E',
    surfaceAlt: '#1B2440',
    line: '#273253',
    text: '#E9EDF7',
    muted: '#93A0BE',
    faint: '#5B6788',
    gold: '#F3B544',
    goldInk: '#1D1503',
    goldSoft: 'rgba(243, 181, 68, 0.14)',
    coinInk: '#1D1503',
    up: '#2FD08F',
    upSoft: 'rgba(47, 208, 143, 0.16)',
    down: '#FF5C7A',
    downSoft: 'rgba(255, 92, 122, 0.16)',
    onSide: '#06111F',
    news: '#FFD35C',
    newsInk: '#1D1503',
  },
  light: {
    bg: '#EEF1F8',
    surface: '#FFFFFF',
    surfaceAlt: '#F4F6FB',
    line: '#D9DFEC',
    text: '#111727',
    muted: '#5A6582',
    faint: '#8D97B0',
    gold: '#C98A12',
    goldInk: '#FFFFFF',
    goldSoft: 'rgba(201, 138, 18, 0.12)',
    coinInk: '#FFF7E3',
    up: '#0E9D66',
    upSoft: 'rgba(14, 157, 102, 0.12)',
    down: '#D83A5A',
    downSoft: 'rgba(216, 58, 90, 0.12)',
    onSide: '#FFFFFF',
    news: '#FFD35C',
    newsInk: '#1D1503',
  },
};

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const type = {
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  num: { fontVariant: ['tabular-nums' as const] },
};
