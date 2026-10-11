import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InboxBanner, Toast } from './src/components/Overlays';
import { DuelResult, DuelScreen } from './src/screens/DuelScreen';
import { HubScreen } from './src/screens/HubScreen';
import { InboxScreen } from './src/screens/InboxScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ResultScreen, RewardState } from './src/screens/ResultScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { StoreProvider, useStore } from './src/state/store';
import { NightBackdrop } from './src/ui/luxe';
import { fonts } from './src/ui/theme';

type Route =
  | { name: 'hub' }
  | { name: 'settings' }
  | { name: 'wallet' }
  | { name: 'inbox'; back: 'hub' | 'settings' }
  | { name: 'duel'; matchId: string; seed: number }
  | { name: 'result'; result: DuelResult; reward: RewardState };

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
      setRoute(route.name === 'inbox' && route.back === 'settings' ? { name: 'settings' } : { name: 'hub' });
      return true;
    });
    return () => sub.remove();
  }, [route, status, loginInbox]);

  const play = useCallback(async () => {
    setStarting(true);
    try {
      const m = await startMatch();
      setRoute({ name: 'duel', matchId: m.matchId, seed: m.seed });
    } catch {
      notify(t('net.error'));
    } finally {
      setStarting(false);
    }
  }, [startMatch, notify, t]);

  const saveResult = useCallback(
    async (result: DuelResult) => {
      const update = (reward: RewardState) =>
        setRoute((r) => (r.name === 'result' && r.result.matchId === result.matchId ? { ...r, reward } : r));
      setRoute({ name: 'result', result, reward: { state: 'saving' } });
      try {
        const res = await finishMatch(result.matchId, result.myPlace, result.actions);
        update({ state: 'done', amount: res.reward });
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
            onPlay={play}
            starting={starting}
            onSettings={() => setRoute({ name: 'settings' })}
            onWallet={() => setRoute({ name: 'wallet' })}
          />
        );
        break;
      case 'settings':
        screen = <SettingsScreen onBack={() => setRoute({ name: 'hub' })} onInbox={() => setRoute({ name: 'inbox', back: 'settings' })} />;
        break;
      case 'wallet':
        screen = <WalletScreen onBack={() => setRoute({ name: 'hub' })} />;
        break;
      case 'inbox':
        screen = <InboxScreen onBack={() => setRoute(route.back === 'settings' ? { name: 'settings' } : { name: 'hub' })} />;
        break;
      case 'duel':
        screen = (
          <DuelScreen
            key={route.matchId}
            matchId={route.matchId}
            seed={route.seed}
            onLeave={() => setRoute({ name: 'hub' })}
            onFinish={saveResult}
          />
        );
        break;
      case 'result':
        screen = (
          <ResultScreen
            result={route.result}
            reward={route.reward}
            onRetry={() => saveResult(route.result)}
            onAgain={play}
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
      <InboxBanner onOpen={openInbox} />
      <Toast />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
