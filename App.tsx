import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GameId } from './src/games';
import { DuelResult, DuelScreen } from './src/screens/DuelScreen';
import { HubScreen } from './src/screens/HubScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StoreProvider, useStore } from './src/state/store';

type Route =
  | { name: 'hub' }
  | { name: 'settings' }
  | { name: 'duel'; run: number }
  | { name: 'result'; result: DuelResult };

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { ready, colors, scheme, recordMatch } = useStore();
  const [route, setRoute] = useState<Route>({ name: 'hub' });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'hub') return false;
      if (route.name === 'duel') return true; // leaving a match takes the in-game button
      setRoute({ name: 'hub' });
      return true;
    });
    return () => sub.remove();
  }, [route.name]);

  const play = (_id: GameId) => setRoute({ name: 'duel', run: Date.now() });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {!ready ? (
        <View style={styles.root} />
      ) : route.name === 'hub' ? (
        <HubScreen onPlay={play} onSettings={() => setRoute({ name: 'settings' })} />
      ) : route.name === 'settings' ? (
        <SettingsScreen onBack={() => setRoute({ name: 'hub' })} />
      ) : route.name === 'duel' ? (
        <DuelScreen
          key={route.run}
          onLeave={() => setRoute({ name: 'hub' })}
          onFinish={(result) => {
            recordMatch({ matchId: result.matchId, place: result.myPlace, reward: result.reward });
            setRoute({ name: 'result', result });
          }}
        />
      ) : (
        <ResultScreen result={route.result} onAgain={() => play('duel')} onHub={() => setRoute({ name: 'hub' })} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
