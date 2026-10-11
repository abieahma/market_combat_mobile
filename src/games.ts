// Games shown in the Market Combat hub. New games are added here.

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
}

export const GAMES: GameInfo[] = [
  { id: 'duel', title: 'duel.title', tagline: 'duel.tagline', players: 4, seconds: MATCH_SECONDS, offline: true },
];
