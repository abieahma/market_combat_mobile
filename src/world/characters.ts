// The four free characters. The character a player picks sets the world of
// every game: the light behind the screens, the colour of the world, the
// wording of menus, the story line and (later) the sounds.

import type { CharacterId } from '../api/contract';
import type { LangCode, StringKey } from '../i18n/strings';
import type { Scheme } from '../ui/theme';

export interface Character {
  id: CharacterId;
  /** Outfit and world colour: main, deep (shadows) and light (highlights). */
  color: string;
  colorDeep: string;
  colorLight: string;
  /** Light rising behind the screens, per theme. */
  glow: Record<Scheme, string>;
  /** Text on top of the world colour. */
  ink: string;
  /** Sound pack to load once sounds are added. */
  soundPack: string;
  text: { role: StringKey; motto: StringKey; games: StringKey; play: StringKey };
}

export const CHARACTERS: Record<CharacterId, Character> = {
  valdberik: {
    id: 'valdberik',
    color: '#8E3FD0',
    colorDeep: '#55207F',
    colorLight: '#C08BF2',
    glow: { dark: '#8E3FD0', light: '#C9A2EE' },
    ink: '#FFFFFF',
    soundPack: 'violet-warehouse',
    text: { role: 'w.valdberik.role', motto: 'w.valdberik.motto', games: 'w.valdberik.games', play: 'w.valdberik.play' },
  },
  ozonik: {
    id: 'ozonik',
    color: '#2E5FE6',
    colorDeep: '#1A378F',
    colorLight: '#8DABFF',
    glow: { dark: '#2E5FE6', light: '#A9BFFA' },
    ink: '#FFFFFF',
    soundPack: 'blue-hub',
    text: { role: 'w.ozonik.role', motto: 'w.ozonik.motto', games: 'w.ozonik.games', play: 'w.ozonik.play' },
  },
  avitos: {
    id: 'avitos',
    color: '#1499C6',
    colorDeep: '#0B5C79',
    colorLight: '#7FD3F0',
    glow: { dark: '#1499C6', light: '#9ED9EE' },
    ink: '#FFFFFF',
    soundPack: 'flea-market',
    text: { role: 'w.avitos.role', motto: 'w.avitos.motto', games: 'w.avitos.games', play: 'w.avitos.play' },
  },
  yandos: {
    id: 'yandos',
    color: '#F2C200',
    colorDeep: '#A67F00',
    colorLight: '#FFE36B',
    glow: { dark: '#D9A400', light: '#F3D872' },
    ink: '#1A1400',
    soundPack: 'yellow-route',
    text: { role: 'w.yandos.role', motto: 'w.yandos.motto', games: 'w.yandos.games', play: 'w.yandos.play' },
  },
};

const NAMES: Record<'cyr' | 'lat' | 'uk' | 'be' | 'hy', Record<CharacterId, string>> = {
  cyr: { valdberik: 'Валдберик', ozonik: 'Озоник', avitos: 'Авитос', yandos: 'Яндос' },
  uk: { valdberik: 'Валдберік', ozonik: 'Озонік', avitos: 'Авітос', yandos: 'Яндос' },
  be: { valdberik: 'Валдберык', ozonik: 'Озонік', avitos: 'Авітос', yandos: 'Яндос' },
  hy: { valdberik: 'Վալդբերիկ', ozonik: 'Օզոնիկ', avitos: 'Ավիտոս', yandos: 'Յանդոս' },
  lat: { valdberik: 'Valdberik', ozonik: 'Ozonik', avitos: 'Avitos', yandos: 'Yandos' },
};

export function characterName(id: CharacterId, lang: LangCode): string {
  switch (lang) {
    case 'ru':
    case 'kk':
    case 'ky':
    case 'tg':
      return NAMES.cyr[id];
    case 'uk':
      return NAMES.uk[id];
    case 'be':
      return NAMES.be[id];
    case 'hy':
      return NAMES.hy[id];
    default:
      return NAMES.lat[id];
  }
}

/** World colour readable on the current theme: light shade at night, deep shade by day. */
export function worldColor(id: CharacterId, scheme: Scheme): string {
  const c = CHARACTERS[id];
  return scheme === 'dark' ? c.colorLight : c.colorDeep;
}
