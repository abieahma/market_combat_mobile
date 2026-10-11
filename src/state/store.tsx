// App-wide state: UI settings, player profile and the ABIE wallet.
//
// For now everything lives on the device. The wallet is kept as a ledger
// (every credit is an entry with a reason), so it can move to the game
// server as-is and, later, be mapped onto an on-chain token.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { DEFAULT_LANG, formatNumber, isLangCode, LangCode, STRINGS, StringKey } from '../i18n/strings';
import { Colors, PALETTES, Scheme, ThemeMode } from '../ui/theme';

const STORAGE_KEY = 'mcombat.v1';
export const WELCOME_BONUS = 100;
const LEDGER_LIMIT = 200;
export const NICKNAME_MAX = 16;

export interface LedgerEntry {
  id: string;
  ts: number;
  amount: number;
  reason: 'welcome' | 'match';
  ref?: string;
}

export interface Settings {
  lang: LangCode;
  theme: ThemeMode;
  haptics: boolean;
}

export interface Profile {
  nickname: string;
  matches: number;
  wins: number;
  earned: number;
}

export interface Wallet {
  balance: number;
  ledger: LedgerEntry[];
}

interface SavedData {
  version: 1;
  settings: Settings;
  profile: Profile;
  wallet: Wallet;
}

export type HapticKind = 'tap' | 'success' | 'warning' | 'error';

interface StoreValue {
  ready: boolean;
  settings: Settings;
  profile: Profile;
  wallet: Wallet;
  scheme: Scheme;
  colors: Colors;
  t: (key: StringKey) => string;
  fmt: (value: number, decimals?: number) => string;
  setLang: (lang: LangCode) => void;
  setTheme: (theme: ThemeMode) => void;
  setHaptics: (on: boolean) => void;
  setNickname: (name: string) => void;
  recordMatch: (result: { matchId: string; place: number; reward: number }) => void;
  haptic: (kind: HapticKind) => void;
}

function freshData(): SavedData {
  const tag = Math.floor(1000 + Math.random() * 9000);
  return {
    version: 1,
    settings: { lang: DEFAULT_LANG, theme: 'dark', haptics: true },
    profile: { nickname: `Trader${tag}`, matches: 0, wins: 0, earned: 0 },
    wallet: {
      balance: WELCOME_BONUS,
      ledger: [{ id: 'welcome', ts: Date.now(), amount: WELCOME_BONUS, reason: 'welcome' }],
    },
  };
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Accepts whatever is in storage and returns valid data, filling gaps from defaults. */
function sanitize(raw: unknown): SavedData {
  const base = freshData();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SavedData>;
  const s = (r.settings ?? {}) as Partial<Settings>;
  const p = (r.profile ?? {}) as Partial<Profile>;
  const w = (r.wallet ?? {}) as Partial<Wallet>;
  return {
    version: 1,
    settings: {
      lang: isLangCode(s.lang) ? s.lang : base.settings.lang,
      theme: s.theme === 'system' || s.theme === 'light' || s.theme === 'dark' ? s.theme : base.settings.theme,
      haptics: typeof s.haptics === 'boolean' ? s.haptics : base.settings.haptics,
    },
    profile: {
      nickname: typeof p.nickname === 'string' && p.nickname.trim() ? p.nickname.slice(0, NICKNAME_MAX) : base.profile.nickname,
      matches: num(p.matches, 0),
      wins: num(p.wins, 0),
      earned: num(p.earned, 0),
    },
    wallet: {
      balance: num(w.balance, base.wallet.balance),
      ledger: Array.isArray(w.ledger) ? w.ledger.slice(-LEDGER_LIMIT) : base.wallet.ledger,
    },
  };
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SavedData>(freshData);
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((text) => {
        if (alive && text) setData(sanitize(JSON.parse(text)));
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
  }, [data, ready]);

  const { settings, profile, wallet } = data;
  const scheme: Scheme = settings.theme === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : settings.theme;

  const haptic = useCallback(
    (kind: HapticKind) => {
      if (!settings.haptics || Platform.OS === 'web') return;
      const run =
        kind === 'tap'
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          : Haptics.notificationAsync(
              kind === 'success'
                ? Haptics.NotificationFeedbackType.Success
                : kind === 'warning'
                  ? Haptics.NotificationFeedbackType.Warning
                  : Haptics.NotificationFeedbackType.Error,
            );
      run.catch(() => {});
    },
    [settings.haptics],
  );

  const value = useMemo<StoreValue>(() => {
    const dict = STRINGS[settings.lang];
    const patch = (fn: (d: SavedData) => SavedData) => setData((d) => fn(d));
    return {
      ready,
      settings,
      profile,
      wallet,
      scheme,
      colors: PALETTES[scheme],
      t: (key) => dict[key] ?? STRINGS.en[key],
      fmt: (v, decimals = 0) => formatNumber(v, decimals, settings.lang),
      setLang: (lang) => patch((d) => ({ ...d, settings: { ...d.settings, lang } })),
      setTheme: (theme) => patch((d) => ({ ...d, settings: { ...d.settings, theme } })),
      setHaptics: (on) => patch((d) => ({ ...d, settings: { ...d.settings, haptics: on } })),
      setNickname: (name) =>
        patch((d) => {
          const nickname = name.replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
          return nickname ? { ...d, profile: { ...d.profile, nickname } } : d;
        }),
      recordMatch: ({ matchId, place, reward }) =>
        patch((d) => {
          if (d.wallet.ledger.some((e) => e.ref === matchId)) return d; // already paid
          const entry: LedgerEntry = { id: `m-${matchId}`, ts: Date.now(), amount: reward, reason: 'match', ref: matchId };
          return {
            ...d,
            profile: {
              ...d.profile,
              matches: d.profile.matches + 1,
              wins: d.profile.wins + (place === 1 ? 1 : 0),
              earned: d.profile.earned + reward,
            },
            wallet: { balance: d.wallet.balance + reward, ledger: [...d.wallet.ledger, entry].slice(-LEDGER_LIMIT) },
          };
        }),
      haptic,
    };
  }, [ready, settings, profile, wallet, scheme, haptic]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}
