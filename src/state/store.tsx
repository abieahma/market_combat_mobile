// App-wide state.
//
// The app keeps only device settings, the session key and a cached copy of
// the profile and balance. Everything that matters lives on the server
// (today the stub in src/mock-server); the app talks to it through `api`.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { createContext, ReactNode, useCallback, useEffect, useMemo, useRef, useState, useContext } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { ApiClient, createApi } from '../api/client';
import { currentCharacterId } from '../api/contract';
import type { Account, AuthResult, CharacterId, GameEntry, GameId, Gender, MatchAction, MatchFinished, MatchStarted, Profile } from '../api/contract';
import { isApiError } from '../api/transport';
import { DEFAULT_LANG, fill, formatNumber, isLangCode, LangCode, STRINGS, StringKey } from '../i18n/strings';
import { server } from '../mock-server';
import { MockTransport, NetworkSim } from '../mock-server/transport';
import { Colors, paletteFor, Scheme, ThemeMode } from '../ui/theme';
import { CHARACTERS } from '../world/characters';

const KEYS = {
  settings: 'mcombat.settings',
  session: 'mcombat.session',
  cache: 'mcombat.cache',
  net: 'mcombat.net',
  dev: 'mcombat.dev',
  legacy: 'mcombat.v1',
};

export interface Settings {
  lang: LangCode;
  theme: ThemeMode;
  haptics: boolean;
}

interface Cache {
  account: Account;
  profile: Profile;
  balance: number;
  /** Games published on the platform, as the server last listed them. */
  games?: GameEntry[];
  /** Paid games this player has opened. */
  opened?: string[];
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';
export type HapticKind = 'tap' | 'success' | 'warning' | 'error';

const DEFAULT_SETTINGS: Settings = { lang: DEFAULT_LANG, theme: 'dark', haptics: true };
const DEFAULT_NET: NetworkSim = { latency: true, failures: false };

// The network settings are read on every request, so they live outside React.
let netSim: NetworkSim = DEFAULT_NET;
export const api: ApiClient = createApi(new MockTransport(server, () => netSim));

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const text = await AsyncStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

function removeKey(key: string) {
  AsyncStorage.removeItem(key).catch(() => {});
}

function sanitizeSettings(raw: unknown): Settings {
  const s = (raw ?? {}) as Partial<Settings>;
  return {
    lang: isLangCode(s.lang) ? s.lang : DEFAULT_SETTINGS.lang,
    theme: s.theme === 'system' || s.theme === 'light' || s.theme === 'dark' ? s.theme : DEFAULT_SETTINGS.theme,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULT_SETTINGS.haptics,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A fresh key for a request that must not be applied twice. */
export function requestId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Repeats a request while the network fails; the server must treat repeats as one. */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await run();
    } catch (e) {
      lastError = e;
      if (!isApiError(e) || e.code !== 'network') break;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

interface StoreValue {
  status: AuthStatus;
  settings: Settings;
  scheme: Scheme;
  colors: Colors;
  t: (key: StringKey) => string;
  tf: (key: StringKey, vars: Record<string, string | number>) => string;
  fmt: (value: number, decimals?: number) => string;
  setLang: (lang: LangCode) => void;
  setTheme: (theme: ThemeMode) => void;
  setHaptics: (on: boolean) => void;
  haptic: (kind: HapticKind) => void;

  account: Account | null;
  profile: Profile | null;
  balance: number;
  completeSignIn: (result: AuthResult) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setNickname: (name: string) => Promise<void>;
  /** Games on the platform (all of them; the hub picks the ones of the player's universe). */
  games: GameEntry[];
  opened: string[];
  /** Opens a match; for a game with a currency the stake is bought from ABIE in the same step. */
  startMatch: (game: GameId, stakeLots: number) => Promise<MatchStarted>;
  finishMatch: (matchId: string, place: number, equity: number, actions: MatchAction[]) => Promise<MatchFinished>;
  chooseCharacter: (character: CharacterId, gender: Gender) => Promise<void>;
  changeCharacter: (character: CharacterId) => Promise<void>;
  changeGender: (gender: Gender) => Promise<void>;

  net: NetworkSim;
  setNet: (patch: Partial<NetworkSim>) => void;
  /** Developer panel: a test opponent joins fights against players. */
  sparring: boolean;
  setSparring: (on: boolean) => void;
  resetServer: () => Promise<void>;

  toast: string | null;
  notify: (message: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [cache, setCache] = useState<Cache | null>(null);
  const [net, setNetState] = useState<NetworkSim>(DEFAULT_NET);
  const [sparring, setSparringState] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemScheme = useColorScheme();

  const saveCache = useCallback((next: Cache | null) => {
    setCache(next);
    if (next) writeJson(KEYS.cache, next);
    else removeKey(KEYS.cache);
  }, []);

  const updateCache = useCallback((change: (c: Cache) => Cache) => {
    setCache((c) => {
      const next = c ? change(c) : c;
      if (next) writeJson(KEYS.cache, next);
      return next;
    });
  }, []);

  const signOutLocally = useCallback(() => {
    api.setToken(null);
    removeKey(KEYS.session);
    saveCache(null);
    setStatus('signedOut');
  }, [saveCache]);

  const refresh = useCallback(async () => {
    try {
      const [me, wallet, games] = await Promise.all([api.me.get(), api.wallet.get(), api.games.list()]);
      saveCache({ account: me.account, profile: me.profile, balance: wallet.balance, games: games.items, opened: games.opened });
    } catch (e) {
      if (isApiError(e) && e.code === 'unauthorized') signOutLocally();
      // Network trouble: keep showing the cached copy.
    }
  }, [saveCache, signOutLocally]);

  // Start-up: settings, network simulation, session.
  useEffect(() => {
    (async () => {
      const storedSettings = await readJson<Settings>(KEYS.settings);
      const legacy = storedSettings ? null : await readJson<{ settings?: unknown }>(KEYS.legacy);
      setSettings(sanitizeSettings(storedSettings ?? legacy?.settings));

      const storedDev = await readJson<{ sparring?: boolean }>(KEYS.dev);
      if (storedDev?.sparring) {
        server.devSettings.sparring = true;
        setSparringState(true);
      }

      const storedNet = await readJson<NetworkSim>(KEYS.net);
      if (storedNet) {
        netSim = { ...DEFAULT_NET, ...storedNet };
        setNetState(netSim);
      }

      let token: string | null = null;
      try {
        token = await AsyncStorage.getItem(KEYS.session);
      } catch {
        token = null;
      }
      if (!token) {
        setStatus('signedOut');
        return;
      }
      api.setToken(token);
      const stored = await readJson<Cache>(KEYS.cache);
      // Copies saved with an old character id read as the new one.
      const cached = stored ? { ...stored, profile: { ...stored.profile, character: currentCharacterId(stored.profile.character) } } : null;
      if (cached) {
        setCache(cached);
        setStatus('signedIn');
        refresh();
      } else {
        try {
          const [me, wallet, games] = await Promise.all([api.me.get(), api.wallet.get(), api.games.list()]);
          saveCache({ account: me.account, profile: me.profile, balance: wallet.balance, games: games.items, opened: games.opened });
          setStatus('signedIn');
        } catch {
          signOutLocally();
        }
      }
    })();
  }, [refresh, saveCache, signOutLocally]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeJson(KEYS.settings, next);
      return next;
    });
  }, []);

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

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const scheme: Scheme = settings.theme === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : settings.theme;

  const value = useMemo<StoreValue>(() => {
    const dict = STRINGS[settings.lang];
    const t = (key: StringKey) => dict[key] ?? STRINGS.en[key];
    return {
      status,
      settings,
      scheme,
      colors: paletteFor(scheme, cache?.profile.character ? CHARACTERS[cache.profile.character] : null),
      t,
      tf: (key, vars) => fill(t(key), vars),
      fmt: (v, decimals = 0) => formatNumber(v, decimals, settings.lang),
      setLang: (lang) => updateSettings({ lang }),
      setTheme: (theme) => updateSettings({ theme }),
      setHaptics: (on) => updateSettings({ haptics: on }),
      haptic,

      account: cache?.account ?? null,
      profile: cache?.profile ?? null,
      balance: cache?.balance ?? 0,

      completeSignIn: (result) => {
        api.setToken(result.session.token);
        AsyncStorage.setItem(KEYS.session, result.session.token).catch(() => {});
        saveCache({ account: result.account, profile: result.profile, balance: cache?.balance ?? 0, games: cache?.games, opened: [] });
        setStatus('signedIn');
        refresh();
      },
      logout: async () => {
        try {
          await api.auth.logout();
        } catch {
          // The session is dropped on this device either way.
        }
        signOutLocally();
      },
      refresh,
      setNickname: async (name) => {
        const profile = await api.me.patch({ nickname: name });
        updateCache((c) => ({ ...c, profile }));
      },
      games: cache?.games ?? [],
      opened: cache?.opened ?? [],
      startMatch: async (game, stakeLots) => {
        // One id per tap: a repeat after a lost answer opens the same match and charges once.
        const id = requestId();
        const res = await withRetry(() => api.matches.start({ game, stakeLots, requestId: id }));
        const tx = res.tx;
        if (tx) updateCache((c) => ({ ...c, balance: tx.balanceAfter }));
        return res;
      },
      finishMatch: async (matchId, place, equity, actions) => {
        // The server settles a match only once, so retrying after a lost answer is safe.
        const res = await withRetry(() => api.matches.finish(matchId, { place, equity, actions }));
        updateCache((c) => ({ ...c, profile: res.profile, balance: res.tx ? res.tx.balanceAfter : c.balance }));
        refresh();
        return res;
      },
      chooseCharacter: async (character, gender) => {
        const profile = await api.me.chooseCharacter(character, gender);
        updateCache((c) => ({ ...c, profile }));
      },
      changeCharacter: async (character) => {
        // One id per tap: a repeat after a lost answer is not charged twice.
        const id = requestId();
        const res = await withRetry(() => api.me.changeCharacter(character, id));
        updateCache((c) => ({ ...c, profile: res.profile, balance: res.tx.balanceAfter }));
      },
      changeGender: async (gender) => {
        const profile = await api.me.changeGender(gender);
        updateCache((c) => ({ ...c, profile }));
      },

      net,
      setNet: (patch) => {
        netSim = { ...netSim, ...patch };
        setNetState(netSim);
        writeJson(KEYS.net, netSim);
      },
      sparring,
      setSparring: (on) => {
        server.devSettings.sparring = on;
        setSparringState(on);
        writeJson(KEYS.dev, { sparring: on });
      },
      resetServer: async () => {
        await server.dev.reset();
        signOutLocally();
      },

      toast,
      notify,
    };
  }, [status, settings, scheme, haptic, cache, refresh, saveCache, updateCache, signOutLocally, updateSettings, net, sparring, toast, notify]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}
