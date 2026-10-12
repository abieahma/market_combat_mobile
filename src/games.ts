// How the app shows the games it knows. Which games exist, which universes
// they belong to and their currencies come from the server's game registry
// (GET /v1/games); this file only adds titles, art and stake choices.

import type { CharacterId, GameEntry } from './api/contract';
import { MATCH_SECONDS } from './game/duel';
import { StringKey } from './i18n/strings';

export type GameId = 'duel' | 'kombat';

export interface GameInfo {
  id: GameId;
  title: StringKey;
  tagline: StringKey;
  players: number;
  /** Length of a match; null when it has no fixed length. */
  seconds: number | null;
  /** Shown while the game is played against bots only. */
  offline: boolean;
  /** An amount of the game currency as shown, from an already formatted number: $1,000 or 100 KMB. */
  money: (formatted: string) => string;
  /** Stakes offered before a match, in lots of the game's rate. */
  stakes: number[];
  /** What the stake sheet explains about the stake. */
  stakeText: StringKey;
}

export const GAMES: GameInfo[] = [
  {
    id: 'duel',
    title: 'duel.title',
    tagline: 'duel.tagline',
    players: 4,
    seconds: MATCH_SECONDS,
    offline: true,
    money: (n) => `$${n}`,
    stakes: [5, 10, 25, 50, 100],
    stakeText: 'stake.text',
  },
  {
    id: 'kombat',
    title: 'kombat.title',
    tagline: 'kombat.tagline',
    players: 2,
    seconds: null,
    offline: false,
    money: (n) => `${n} KMB`,
    stakes: [5, 10, 25, 50],
    stakeText: 'kombat.stakeText',
  },
];

export interface ShownGame {
  info: GameInfo;
  /** Registry entry; null until the registry has been loaded. */
  entry: GameEntry | null;
  /** False until a character is chosen: tapping the game opens the choice. */
  playable: boolean;
  /** A paid game this player has not opened yet. */
  needsEntry: boolean;
}

/**
 * Games for the hub. Without a character: every game, none playable yet.
 * With one: the games of its universe plus the common ones.
 */
export function shownGames(registry: GameEntry[], character: CharacterId | null, opened: string[] = []): ShownGame[] {
  if (registry.length === 0) return GAMES.map((info) => ({ info, entry: null, playable: false, needsEntry: false }));
  const out: ShownGame[] = [];
  for (const entry of registry) {
    const info = GAMES.find((g) => g.id === entry.id);
    if (!info) continue; // published, but this version of the app cannot show it yet
    const needsEntry = entry.entry?.kind === 'paid' && !opened.includes(entry.id);
    if (!character) out.push({ info, entry, playable: false, needsEntry });
    else if (entry.universes === 'all' || entry.universes.includes(character)) out.push({ info, entry, playable: true, needsEntry });
  }
  return out;
}
