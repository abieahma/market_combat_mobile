import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InboxBanner, Toast } from './src/components/Overlays';
import { KombatLobby } from './src/components/KombatLobby';
import { StakeSheet } from './src/components/StakeSheet';
import type { Proposal } from './src/api/contract';
import { isApiError } from './src/api/transport';
import { ShownGame, shownGames } from './src/games';
import { CharacterScreen } from './src/screens/CharacterScreen';
import { DuelResult, DuelScreen } from './src/screens/DuelScreen';
import { HubScreen } from './src/screens/HubScreen';
import { InboxScreen } from './src/screens/InboxScreen';
import { KombatScreen } from './src/screens/KombatScreen';
import { ModerationScreen } from './src/screens/ModerationScreen';
import { ProposalFormScreen, ProposalScreen, ProposalsScreen } from './src/screens/ProposalsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ResultScreen, SettleState } from './src/screens/ResultScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { api, requestId, StoreProvider, useStore } from './src/state/store';
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
  | { name: 'result'; result: DuelResult; settle: SettleState }
  | { name: 'kombat'; fightId: string }
  | { name: 'proposals' }
  | { name: 'proposalNew' }
  | { name: 'proposal'; id: string }
  | { name: 'proposalEdit'; proposal: Proposal }
  | { name: 'moderation' };

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
  const { status, colors, look, startMatch, finishMatch, notify, t, games, profile, opened, refresh, showMoney } = useStore();
  const [route, setRoute] = useState<Route>({ name: 'hub' });
  const [loginInbox, setLoginInbox] = useState(false);
  const [starting, setStarting] = useState(false);
  /** Game whose stake sheet is open. */
  const [stakeFor, setStakeFor] = useState<ShownGame | null>(null);
  /** Last game played, for "Play again". */
  const [lastGame, setLastGame] = useState<ShownGame | null>(null);
  const [kombatLobby, setKombatLobby] = useState(false);

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
      if (route.name === 'duel' || route.name === 'kombat') return true; // leaving a fight takes the in-game button
      if (route.name === 'proposalNew' || route.name === 'proposal') {
        setRoute({ name: 'proposals' });
        return true;
      }
      if (route.name === 'proposalEdit') {
        setRoute({ name: 'proposal', id: route.proposal.id });
        return true;
      }
      const backToSettings =
        route.name === 'character' || route.name === 'moderation' || (route.name === 'inbox' && route.back === 'settings');
      // 'choose' and everything else go back to the hub.
      setRoute(backToSettings ? { name: 'settings' } : { name: 'hub' });
      return true;
    });
    return () => sub.remove();
  }, [route, status, loginInbox]);

  const failed = useCallback(
    (e: unknown) => notify(isApiError(e) && e.code === 'insufficient_funds' ? t('char.notEnough') : t('net.error')),
    [notify, t],
  );

  /** Market Kombat: a training fight, or a fight with a player for `lots` of stake. */
  const startKombat = useCallback(
    async (mode: 'bot' | 'pvp', lots?: number) => {
      setStarting(true);
      try {
        const v = await api.kombat.start(mode, lots, requestId());
        setKombatLobby(false);
        setStakeFor(null);
        refresh();
        setRoute({ name: 'kombat', fightId: v.id });
      } catch (e) {
        failed(e);
      } finally {
        setStarting(false);
      }
    },
    [failed, refresh],
  );

  const play = useCallback(
    async (game: ShownGame, lots: number) => {
      if (game.info.id === 'kombat') return startKombat('pvp', lots);
      setStarting(true);
      try {
        const m = await startMatch(game.info.id, lots);
        setStakeFor(null);
        setRoute({ name: 'duel', matchId: m.matchId, seed: m.seed, stake: m.stake });
      } catch (e) {
        failed(e);
      } finally {
        setStarting(false);
      }
    },
    [startMatch, startKombat, failed],
  );

  const openStake = useCallback((game: ShownGame) => {
    setLastGame(game);
    if (game.info.id === 'kombat') setKombatLobby(true);
    else setStakeFor(game);
  }, []);

  /** Opens a paid game: one payment, then it stays open. */
  const payEntry = useCallback(
    async (game: ShownGame) => {
      try {
        await api.games.payEntry(game.info.id, requestId());
        refresh();
      } catch (e) {
        failed(e);
      }
    },
    [failed, refresh],
  );

  const kombatGame = shownGames(games, profile?.character ?? null, opened).find((g) => g.info.id === 'kombat') ?? null;

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
            onChoose={() => setRoute({ name: profile?.character ? 'character' : 'choose' })}
            onPayEntry={payEntry}
            onPropose={() => setRoute({ name: 'proposals' })}
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
            onModeration={() => setRoute({ name: 'moderation' })}
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
            money={(units) => (lastGame ? showMoney(lastGame.info, units) : String(units))}
            onRetry={() => saveResult(route.result)}
            onAgain={() => lastGame && openStake(lastGame)}
            starting={starting}
            onHub={() => setRoute({ name: 'hub' })}
          />
        );
        break;
      case 'kombat':
        screen = (
          <KombatScreen key={route.fightId} fightId={route.fightId} onHub={() => setRoute({ name: 'hub' })} onAgain={() => setKombatLobby(true)} />
        );
        break;
      case 'proposals':
        screen = (
          <ProposalsScreen
            onBack={() => setRoute({ name: 'hub' })}
            onNew={() => setRoute({ name: 'proposalNew' })}
            onOpen={(id) => setRoute({ name: 'proposal', id })}
          />
        );
        break;
      case 'proposalNew':
        screen = <ProposalFormScreen onBack={() => setRoute({ name: 'proposals' })} onDone={(p) => setRoute({ name: 'proposal', id: p.id })} />;
        break;
      case 'proposal':
        screen = (
          <ProposalScreen key={route.id} id={route.id} onBack={() => setRoute({ name: 'proposals' })} onEdit={(p) => setRoute({ name: 'proposalEdit', proposal: p })} />
        );
        break;
      case 'proposalEdit':
        screen = (
          <ProposalFormScreen
            proposal={route.proposal}
            onBack={() => setRoute({ name: 'proposal', id: route.proposal.id })}
            onDone={(p) => setRoute({ name: 'proposal', id: p.id })}
          />
        );
        break;
      case 'moderation':
        screen = <ModerationScreen onBack={() => setRoute({ name: 'settings' })} />;
        break;
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={look.statusBar} />
      <NightBackdrop />
      {screen}
      <KombatLobby
        visible={status === 'signedIn' && kombatLobby}
        onClose={() => setKombatLobby(false)}
        onTraining={() => startKombat('bot')}
        onPvp={() => {
          setKombatLobby(false);
          if (kombatGame) setStakeFor(kombatGame);
        }}
        busy={starting}
      />
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
