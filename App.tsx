import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InboxBanner, Toast } from './src/components/Overlays';
import { StakeSheet } from './src/components/StakeSheet';
import { isApiError } from './src/api/transport';
import { ShownGame } from './src/games';
import { CharacterScreen } from './src/screens/CharacterScreen';
import { DuelResult, DuelScreen } from './src/screens/DuelScreen';
import { HubScreen } from './src/screens/HubScreen';
import { InboxScreen } from './src/screens/InboxScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ResultScreen, SettleState } from './src/screens/ResultScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { StoreProvider, useStore } from './src/state/store';
import { NightBackdrop } from './src/ui/luxe';
import { fonts } from './src/ui/theme';

type Route =
  | { name: 'hub' }
  | { name: 'settings' }
  /** First, free character choice; back leads to the hub. */
  | { name: 'choose' }
  /** Paid character change from settings. */
  | { name: 'character' }
  | { name: 'wallet' }
  | { name: 'inbox'; back: 'hub' | 'settings' }
  | { name: 'duel'; matchId: string; seed: number; stake: number }
  | { name: 'result'; result: DuelResult; settle: SettleState };

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    [fonts.display]: require('./assets/fonts/CormorantGaramond-Bold.ttf'),
    [fonts.displaySemi]: require('./assets/fonts/CormorantGaramond-SemiBold.ttf'),
  });
  // Without the fonts the app still works, in the system typeface.
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { status, colors, scheme, startMatch, finishMatch, notify, t } = useStore();
  const [route, setRoute] = useState<Route>({ name: 'hub' });
  const [loginInbox, setLoginInbox] = useState(false);
  const [starting, setStarting] = useState(false);
  /** Game whose stake sheet is open. */
  const [stakeFor, setStakeFor] = useState<ShownGame | null>(null);
  /** Last game played, for "Play again". */
  const [lastGame, setLastGame] = useState<ShownGame | null>(null);

  // After signing out, the next sign-in starts at the hub.
  useEffect(() => {
    if (status === 'signedOut') setRoute({ name: 'hub' });
  }, [status]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (status !== 'signedIn') {
        if (loginInbox) {
          setLoginInbox(false);
          return true;
        }
        return false;
      }
      if (route.name === 'hub') return false;
      if (route.name === 'duel') return true; // leaving a match takes the in-game button
      const backToSettings = route.name === 'character' || (route.name === 'inbox' && route.back === 'settings');
      // 'choose' and everything else go back to the hub.
      setRoute(backToSettings ? { name: 'settings' } : { name: 'hub' });
      return true;
    });
    return () => sub.remove();
  }, [route, status, loginInbox]);

  const play = useCallback(
    async (game: ShownGame, lots: number) => {
      setStarting(true);
      try {
        const m = await startMatch(game.info.id, lots);
        setStakeFor(null);
        setRoute({ name: 'duel', matchId: m.matchId, seed: m.seed, stake: m.stake });
      } catch (e) {
        notify(isApiError(e) && e.code === 'insufficient_funds' ? t('char.notEnough') : t('net.error'));
      } finally {
        setStarting(false);
      }
    },
    [startMatch, notify, t],
  );

  const openStake = useCallback((game: ShownGame) => {
    setLastGame(game);
    setStakeFor(game);
  }, []);

  const saveResult = useCallback(
    async (result: DuelResult) => {
      const update = (settle: SettleState) =>
        setRoute((r) => (r.name === 'result' && r.result.matchId === result.matchId ? { ...r, settle } : r));
      setRoute({ name: 'result', result, settle: { state: 'saving' } });
      try {
        const res = await finishMatch(result.matchId, result.myPlace, result.equity, result.actions);
        update({ state: 'done', res });
      } catch {
        update({ state: 'error' });
      }
    },
    [finishMatch],
  );

  const openInbox = () => {
    if (status !== 'signedIn') setLoginInbox(true);
    else setRoute((r) => ({ name: 'inbox', back: r.name === 'settings' ? 'settings' : 'hub' }));
  };

  let screen: ReactNode;
  if (status === 'loading') {
    screen = <View style={styles.root} />;
  } else if (status === 'signedOut') {
    screen = loginInbox ? <InboxScreen onBack={() => setLoginInbox(false)} /> : <LoginScreen onInbox={() => setLoginInbox(true)} />;
  } else {
    switch (route.name) {
      case 'hub':
        screen = (
          <HubScreen
            onPlay={openStake}
            onChoose={() => setRoute({ name: 'choose' })}
            starting={starting}
            onSettings={() => setRoute({ name: 'settings' })}
            onWallet={() => setRoute({ name: 'wallet' })}
          />
        );
        break;
      case 'settings':
        screen = (
          <SettingsScreen
            onBack={() => setRoute({ name: 'hub' })}
            onInbox={() => setRoute({ name: 'inbox', back: 'settings' })}
            onCharacter={() => setRoute({ name: 'character' })}
            onChoose={() => setRoute({ name: 'choose' })}
          />
        );
        break;
      case 'choose':
        screen = <CharacterScreen mode="choose" onBack={() => setRoute({ name: 'hub' })} />;
        break;
      case 'character':
        screen = <CharacterScreen mode="change" onBack={() => setRoute({ name: 'settings' })} />;
        break;
      case 'wallet':
        screen = <WalletScreen onBack={() => setRoute({ name: 'hub' })} />;
        break;
      case 'inbox':
        screen = <InboxScreen onBack={() => setRoute(route.back === 'settings' ? { name: 'settings' } : { name: 'hub' })} />;
        break;
      case 'duel':
        screen = (
          <DuelScreen key={route.matchId} matchId={route.matchId} seed={route.seed} stake={route.stake} onFinish={saveResult} />
        );
        break;
      case 'result':
        screen = (
          <ResultScreen
            result={route.result}
            settle={route.settle}
            sign={lastGame?.info.currencySign ?? '$'}
            onRetry={() => saveResult(route.result)}
            onAgain={() => lastGame && openStake(lastGame)}
            starting={starting}
            onHub={() => setRoute({ name: 'hub' })}
          />
        );
        break;
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <NightBackdrop />
      {screen}
      <StakeSheet
        game={status === 'signedIn' ? stakeFor : null}
        onClose={() => setStakeFor(null)}
        onConfirm={(lots) => stakeFor && play(stakeFor, lots)}
        busy={starting}
      />
      <InboxBanner onOpen={openInbox} />
      <Toast />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
