// How the app shows the games it knows. Which games exist, which universes
// they belong to and their currencies come from the server's game registry
// (GET /v1/games); this file only adds titles, art and stake choices.

import type { CharacterId, GameEntry } from './api/contract';
import { MATCH_SECONDS } from './game/duel';
import { StringKey } from './i18n/strings';

export type GameId = 'duel';

export interface GameInfo {
  id: GameId;
  title: StringKey;
  tagline: StringKey;
  players: number;
  seconds: number;
  /** Shown while the game is played against bots only. */
  offline: boolean;
  /** Sign put before amounts of the game currency. */
  currencySign: string;
  /** Stakes offered before a match, in lots of the game's rate. */
  stakes: number[];
}

export const GAMES: GameInfo[] = [
  {
    id: 'duel',
    title: 'duel.title',
    tagline: 'duel.tagline',
    players: 4,
    seconds: MATCH_SECONDS,
    offline: true,
    currencySign: '$',
    stakes: [5, 10, 25, 50, 100],
  },
];

export interface ShownGame {
  info: GameInfo;
  /** Registry entry; null until the registry has been loaded. */
  entry: GameEntry | null;
  /** False until a character is chosen: tapping the game opens the choice. */
  playable: boolean;
}

/**
 * Games for the hub. Without a character: every game, none playable yet.
 * With one: the games of its universe plus the common ones.
 */
export function shownGames(registry: GameEntry[], character: CharacterId | null): ShownGame[] {
  if (registry.length === 0) return GAMES.map((info) => ({ info, entry: null, playable: false }));
  const out: ShownGame[] = [];
  for (const entry of registry) {
    const info = GAMES.find((g) => g.id === entry.id);
    if (!info) continue; // published, but this version of the app cannot show it yet
    if (!character) out.push({ info, entry, playable: false });
    else if (entry.universes === 'all' || entry.universes.includes(character)) out.push({ info, entry, playable: true });
  }
  return out;
}
