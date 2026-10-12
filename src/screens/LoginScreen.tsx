import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChallengeStarted } from '../api/contract';
import { isApiError } from '../api/transport';
import { LanguageSheet } from '../components/LanguageSheet';
import { Sheet } from '../components/Sheet';
import { StringKey } from '../i18n/strings';
import { makeMockGoogleToken, server, TELEGRAM_BOT } from '../mock-server';
import { api, useStore } from '../state/store';
import { addSimGoogle, setSimPhone, SimGoogle, simDevice } from '../sim/outside';
import { Button, SectionLabel } from '../ui/kit';
import { ShinyCoin } from '../ui/luxe';
import { fonts, radius, space, type } from '../ui/theme';
import { useLookStyles, useType } from '../ui/look';

type Step = { kind: 'menu' } | { kind: 'email' } | { kind: 'code'; email: string; challengeId: string };
type BotFlow = { kind: 'telegram' | 'phone'; challenge: ChallengeStarted };

const TELEGRAM_BLUE = '#2AABEE';

function errorKey(e: unknown): StringKey {
  if (!isApiError(e)) return 'net.error';
  switch (e.code) {
    case 'invalid_input':
      return 'auth.invalidEmail';
    case 'rate_limited':
      return 'auth.tooOften';
    case 'invalid_code':
      return 'auth.wrongCode';
    case 'challenge_expired':
      return 'auth.expired';
    case 'identity_conflict':
      return 'auth.identityConflict';
    default:
      return 'net.error';
  }
}

export function LoginScreen({ onInbox }: { onInbox: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, settings, completeSignIn, haptic, scheme } = useStore();
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<StringKey | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [arrivedCode, setArrivedCode] = useState<string | null>(null);
  const [bot, setBot] = useState<BotFlow | null>(null);
  const [botSheet, setBotSheet] = useState(false);
  const [googleSheet, setGoogleSheet] = useState(false);
  const [langSheet, setLangSheet] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(errorKey(e));
      haptic('error');
    } finally {
      if (alive.current) setBusy(null);
    }
  }, [haptic]);

  // Codes that arrived by email, newest per address: offered for pasting.
  const [codesByEmail, setCodesByEmail] = useState<Record<string, string>>({});
  useEffect(() => server.dev.onInbox((m) => setCodesByEmail((c) => ({ ...c, [m.to]: m.code }))), []);
  useEffect(() => {
    if (step.kind === 'code') setArrivedCode(codesByEmail[step.email] ?? null);
  }, [step, codesByEmail]);

  // Waiting for the Telegram bot: ask the server every second.
  useEffect(() => {
    if (!bot) return;
    const id = setInterval(async () => {
      try {
        const st = await api.auth.challenge(bot.challenge.challengeId);
        if (st.status === 'confirmed') {
          clearInterval(id);
          haptic('success');
          completeSignIn(st);
        } else if (st.status === 'expired' || st.status === 'refused') {
          clearInterval(id);
          setBot(null);
          setBotSheet(false);
          // One identifier, one cabinet: these identifiers already belong to different cabinets.
          setError(st.status === 'refused' ? 'auth.identityConflict' : 'auth.expired');
          if (st.status === 'refused') haptic('error');
        }
      } catch {
        // Network hiccup: try again on the next tick.
      }
    }, 1000);
    return () => clearInterval(id);
  }, [bot, completeSignIn, haptic]);

  const startBot = (kind: 'telegram' | 'phone') =>
    run(kind, async () => {
      const challenge = kind === 'phone' ? await api.auth.phoneStart() : await api.auth.telegramStart();
      setBot({ kind, challenge });
      setBotSheet(true);
    });

  const sendCode = (address: string) =>
    run('email', async () => {
      const res = await api.auth.emailStart(address);
      setArrivedCode(null);
      setCode('');
      setStep({ kind: 'code', email: address.trim().toLowerCase(), challengeId: res.challengeId });
    });

  const verify = (challengeId: string, value: string) =>
    run('verify', async () => {
      const res = await api.auth.emailVerify(challengeId, value);
      haptic('success');
      completeSignIn(res);
    });

  const signInGoogle = (g: SimGoogle) =>
    run('google', async () => {
      setGoogleSheet(false);
      const res = await api.auth.google(makeMockGoogleToken(g));
      haptic('success');
      completeSignIn(res);
    });

  const langName = settings.lang.toUpperCase();

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.language')}
          onPress={() => setLangSheet(true)}
          style={[styles.langPill, { borderColor: colors.line, backgroundColor: colors.surface }]}
        >
          <Text style={[styles.langText, { color: colors.text }]}>{langName}</Text>
        </Pressable>
      </View>

      <View style={styles.brand}>
        <ShinyCoin size={84} />
        <Text style={[styles.wordmark, { color: scheme === 'dark' ? colors.goldHi : colors.gold }]}>Market Combat</Text>
        <Text style={[tp.body, styles.welcome, { color: colors.muted }]}>{t('auth.welcome')}</Text>
      </View>

      {step.kind === 'menu' && (
        <View style={styles.buttons}>
          <Button variant="glass" label={t('auth.google')} onPress={() => setGoogleSheet(true)} disabled={!!busy} />
          <Button variant="glass" label={t('auth.telegram')} onPress={() => startBot('telegram')} disabled={!!busy} />
          <Button variant="glass" label={t('auth.phone')} onPress={() => startBot('phone')} disabled={!!busy} />
          <Button variant="glass" label={t('auth.email')} onPress={() => setStep({ kind: 'email' })} disabled={!!busy} />
        </View>
      )}

      {step.kind === 'email' && (
        <View style={styles.form}>
          <SectionLabel>{t('auth.emailLabel')}</SectionLabel>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="name@example.com"
            placeholderTextColor={colors.faint}
            onSubmitEditing={() => sendCode(email)}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]}
          />
          <Button label={t('auth.sendCode')} onPress={() => sendCode(email)} disabled={!!busy || !email.trim()} />
          <Button variant="ghost" label={t('common.back')} onPress={() => setStep({ kind: 'menu' })} />
        </View>
      )}

      {step.kind === 'code' && (
        <View style={styles.form}>
          <Text style={[tp.body, { color: colors.text }]}>{tf('auth.codeSentTo', { email: step.email })}</Text>
          <SectionLabel>{t('auth.codeLabel')}</SectionLabel>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="000000"
            placeholderTextColor={colors.faint}
            onSubmitEditing={() => verify(step.challengeId, code)}
            style={[styles.input, styles.codeInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]}
          />
          {arrivedCode && arrivedCode !== code && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setCode(arrivedCode)}
              style={[styles.chip, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}
            >
              <Text style={[styles.chipText, { color: colors.text }]}>
                {t('inbox.new')}: {arrivedCode}
              </Text>
            </Pressable>
          )}
          <Button label={t('auth.verify')} onPress={() => verify(step.challengeId, code)} disabled={!!busy || code.length !== 6} />
          <View style={styles.linksRow}>
            <Button variant="ghost" label={t('auth.resend')} onPress={() => sendCode(step.email)} disabled={!!busy} style={{ flex: 1 }} />
            <Button variant="ghost" label={t('auth.changeEmail')} onPress={() => setStep({ kind: 'email' })} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {bot && !botSheet && (
        <View style={[styles.waiting, { borderColor: colors.line, backgroundColor: colors.surface }]}>
          <ActivityIndicator color={colors.muted} />
          <Text style={[tp.body, { color: colors.text, flex: 1 }]}>{t('auth.waiting')}</Text>
          <Pressable onPress={() => setBotSheet(true)} hitSlop={8}>
            <Text style={[styles.link, { color: TELEGRAM_BLUE }]}>Telegram</Text>
          </Pressable>
          <Pressable onPress={() => setBot(null)} hitSlop={8}>
            <Text style={[styles.link, { color: colors.muted }]}>{t('auth.cancel')}</Text>
          </Pressable>
        </View>
      )}

      {busy && <ActivityIndicator color={colors.goldText} />}
      {error && <Text style={[styles.error, { color: colors.down }]}>{t(error)}</Text>}

      <View style={styles.footer}>
        <Text style={[styles.note, { color: colors.faint }]}>{t('auth.simNote')}</Text>
        <Pressable accessibilityRole="button" onPress={onInbox} hitSlop={8}>
          <Text style={[styles.link, { color: colors.muted }]}>{t('inbox.title')}</Text>
        </Pressable>
      </View>

      <TelegramSheet flow={botSheet ? bot : null} onClose={() => setBotSheet(false)} />
      <GoogleSheet visible={googleSheet} onClose={() => setGoogleSheet(false)} onPick={signInGoogle} />
      <LanguageSheet visible={langSheet} onClose={() => setLangSheet(false)} />
    </ScrollView>
  );
}

/** Stand-in for the Telegram app showing our bot. */
function TelegramSheet({ flow, onClose }: { flow: BotFlow | null; onClose: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, haptic } = useStore();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<StringKey | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!flow) return;
    setError(null);
    simDevice().then((d) => setPhone(d.telegram.phone));
  }, [flow]);

  const press = async () => {
    if (!flow?.challenge.botUrl) return;
    setSending(true);
    setError(null);
    try {
      const device = await simDevice();
      if (flow.kind === 'phone') await setSimPhone(phone);
      await server.dev.telegramConfirm(flow.challenge.botUrl, {
        id: device.telegram.id,
        username: device.telegram.username,
        phone: flow.kind === 'phone' ? phone : undefined,
      });
      haptic('tap');
      onClose();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setError(code === 'challenge_expired' ? 'auth.expired' : code === 'invalid_input' ? 'auth.invalidPhone' : 'net.error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet visible={!!flow} onClose={onClose}>
      <View style={styles.tgHead}>
        <View style={[styles.tgAvatar, { backgroundColor: TELEGRAM_BLUE }]}>
          <Text style={styles.tgAvatarText}>MC</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tgName, { color: colors.text }]}>Market Combat Bot</Text>
          <Text style={[styles.note, { color: colors.muted }]}>@{TELEGRAM_BOT} · Telegram</Text>
        </View>
      </View>
      <View style={[styles.bubble, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[tp.body, { color: colors.text }]}>{flow?.kind === 'phone' ? t('tg.sharePrompt') : t('tg.botHello')}</Text>
      </View>
      {flow?.kind === 'phone' && (
        <>
          <SectionLabel>{t('tg.phoneLabel')}</SectionLabel>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}
          />
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={sending}
        onPress={press}
        style={({ pressed }) => [styles.tgButton, { backgroundColor: TELEGRAM_BLUE, opacity: pressed || sending ? 0.75 : 1 }]}
      >
        <Text style={styles.tgButtonText}>{flow?.kind === 'phone' ? t('tg.share') : t('tg.confirm')}</Text>
      </Pressable>
      {error && <Text style={[styles.error, { color: colors.down }]}>{t(error)}</Text>}
      <Text style={[styles.note, { color: colors.faint }]}>{t('auth.simNote')}</Text>
    </Sheet>
  );
}

/** Stand-in for the Google account chooser. */
function GoogleSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (g: SimGoogle) => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t } = useStore();
  const [accounts, setAccounts] = useState<SimGoogle[]>([]);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAdding(false);
    setEmail('');
    setInvalid(false);
    simDevice().then((d) => setAccounts([...d.google]));
  }, [visible]);

  const add = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setInvalid(true);
      return;
    }
    onPick(await addSimGoogle(email));
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[tp.title, { color: colors.text }]}>{t('auth.chooseGoogle')}</Text>
      {accounts.map((g) => (
        <Pressable
          key={g.sub}
          accessibilityRole="button"
          onPress={() => onPick(g)}
          style={({ pressed }) => [styles.gRow, { borderColor: colors.line, backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
        >
          <View style={[styles.gAvatar, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.gLetter, { color: colors.text }]}>{g.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.tgName, { color: colors.text }]}>{g.name}</Text>
            <Text style={[styles.note, { color: colors.muted }]}>{g.email}</Text>
          </View>
        </Pressable>
      ))}
      {adding ? (
        <>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setInvalid(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="name@gmail.com"
            placeholderTextColor={colors.faint}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}
          />
          {invalid && <Text style={[styles.error, { color: colors.down }]}>{t('auth.invalidEmail')}</Text>}
          <Button label={t('auth.continue')} onPress={add} />
        </>
      ) : (
        <Button variant="ghost" label={t('auth.otherAccount')} onPress={() => setAdding(true)} />
      )}
      <Text style={[styles.note, { color: colors.faint }]}>{t('auth.simNote')}</Text>
    </Sheet>
  );
}

const baseStyles = StyleSheet.create({
  content: { flexGrow: 1, padding: space.lg, gap: space.lg },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  langPill: { height: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  langText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  brand: { marginTop: space.lg, marginBottom: space.md, gap: space.md, alignItems: 'center' },
  wordmark: { fontFamily: fonts.display, fontSize: 46, lineHeight: 52, textAlign: 'center' },
  welcome: { maxWidth: 300, textAlign: 'center' },
  buttons: { gap: space.md },
  form: { gap: space.md },
  input: { height: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 17, fontWeight: '600' },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: 'center', ...type.num },
  chip: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: '700', ...type.num },
  linksRow: { flexDirection: 'row', gap: space.sm },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.md, padding: space.md },
  link: { fontSize: 14, fontWeight: '700' },
  error: { fontSize: 14, fontWeight: '600' },
  footer: { marginTop: 'auto', alignItems: 'center', gap: space.sm, paddingTop: space.xl },
  note: { fontSize: 12 },
  tgHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tgAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tgAvatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  tgName: { fontSize: 16, fontWeight: '700' },
  bubble: { borderRadius: radius.md, borderTopLeftRadius: 4, padding: space.md },
  tgButton: { height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tgButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  gRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  gAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  gLetter: { fontSize: 17, fontWeight: '800' },
});
