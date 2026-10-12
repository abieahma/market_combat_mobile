import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { AuthProvider, Gender, GENDER_CHANGE_COOLDOWN_MS, NICKNAME_MAX, UNIVERSE_RETURN_COST } from '../api/contract';
import { COUNTRIES } from '../wallet/countries';
import { isApiError } from '../api/transport';
import { Avatar, AvatarPlaceholder } from '../components/Avatar';
import { formatWhen, LANGUAGES, StringKey } from '../i18n/strings';
import { GenderToggle } from './CharacterScreen';
import { useStore } from '../state/store';
import { AbieCoin, CheckIcon } from '../ui/icons';
import { Button, SectionLabel, TopBar } from '../ui/kit';
import { Glass } from '../ui/luxe';
import { fonts, radius, space, ThemeMode } from '../ui/theme';
import { characterName, CHARACTERS, worldColor } from '../world/characters';
import { useLookStyles, useType } from '../ui/look';

const THEMES: ThemeMode[] = ['system', 'dark', 'light'];
const THEME_LABEL: Record<ThemeMode, StringKey> = { system: 'theme.system', dark: 'theme.dark', light: 'theme.light' };

const PROVIDER_LABEL: Record<AuthProvider, string | StringKey> = {
  google: 'Google',
  telegram: 'Telegram',
  phone: 'account.phone',
  email: 'auth.emailLabel',
};

export function SettingsScreen({
  onBack,
  onInbox,
  onCharacter,
  onChoose,
  onModeration,
}: {
  onBack: () => void;
  onInbox: () => void;
  /** Developer panel: the moderator's side of game proposals. */
  onModeration: () => void;
  /** Paid change of an already chosen character. */
  onCharacter: () => void;
  /** First, free choice. */
  onChoose: () => void;
}) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const {
    colors,
    t,
    tf,
    settings,
    scheme,
    profile,
    account,
    setLang,
    setTheme,
    setHaptics,
    setNickname,
    changeGender,
    refresh,
    haptic,
    logout,
    net,
    setNet,
    sparring,
    setSparring,
    resetServer,
    notify,
    fmt,
    universe,
    leaveUniverse,
    grantTest,
  } = useStore();
  const [leaveArmed, setLeaveArmed] = useState(false);
  useEffect(() => {
    if (!leaveArmed) return;
    const id = setTimeout(() => setLeaveArmed(false), 3000);
    return () => clearTimeout(id);
  }, [leaveArmed]);
  const savedNick = profile?.nickname ?? '';
  const [nick, setNick] = useState(savedNick);
  const [nickError, setNickError] = useState<StringKey | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  useEffect(() => setNick(savedNick), [savedNick]);
  useEffect(() => {
    if (!resetArmed) return;
    const id = setTimeout(() => setResetArmed(false), 3000);
    return () => clearTimeout(id);
  }, [resetArmed]);

  const saveNick = async () => {
    if (nick.trim() === savedNick) return;
    try {
      await setNickname(nick);
      setNickError(null);
    } catch (e) {
      setNickError(isApiError(e) && e.code === 'invalid_input' ? 'settings.nicknameRule' : 'net.error');
    }
  };

  // Appearance can change once a week; the server keeps the time of the last change.
  const genderFreeAt = profile?.genderChangedAt ? profile.genderChangedAt + GENDER_CHANGE_COOLDOWN_MS : 0;
  const genderLocked = genderFreeAt > Date.now();
  const [genderBusy, setGenderBusy] = useState(false);
  const pickGender = async (g: Gender) => {
    if (!profile || g === profile.gender || genderBusy) return;
    setGenderBusy(true);
    try {
      await changeGender(g);
      haptic('success');
    } catch (e) {
      if (isApiError(e) && e.code === 'rate_limited') await refresh();
      else notify(t('net.error'));
    } finally {
      setGenderBusy(false);
    }
  };

  const providerLabel = (p: AuthProvider) => {
    const label = PROVIDER_LABEL[p];
    return label === 'Google' || label === 'Telegram' ? label : t(label as StringKey);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar title={t('settings.title')} onBack={onBack} />

      {account && (
        <View style={styles.group}>
          <SectionLabel>{t('account.title')}</SectionLabel>
          <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {account.identities.map((id, i) => (
              <View key={id.provider + id.subject} style={[styles.idRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}>
                <Text style={[styles.idProvider, { color: colors.muted }]}>{providerLabel(id.provider)}</Text>
                <Text style={[styles.rowText, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {id.display}
                </Text>
              </View>
            ))}
            {profile?.country && (
              <View style={[styles.idRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}>
                <Text style={[styles.idProvider, { color: colors.muted }]}>{t('country.title')}</Text>
                <Text style={[styles.rowText, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {COUNTRIES[profile.country.code].flag} {profile.country.code} · {profile.country.currency}
                </Text>
              </View>
            )}
          </View>
          {profile?.country && <Text style={[styles.hint, { color: colors.faint }]}>{tf('country.note', { currency: profile.country.currency })}</Text>}
          <Button variant="ghost" label={t('account.logout')} onPress={logout} />
          <Text style={[styles.hint, { color: colors.faint }]}>{t('account.logoutNote')}</Text>
        </View>
      )}

      {profile && !profile.character && (
        <View style={styles.group}>
          <SectionLabel>{t('char.section')}</SectionLabel>
          <Glass style={styles.charCard}>
            <AvatarPlaceholder size={72} />
            <View style={styles.charText}>
              <Text style={[styles.hint, { color: colors.muted }]}>{t('hub.chooseFirst')}</Text>
            </View>
          </Glass>
          <Button label={t('hub.choose')} onPress={onChoose} />
        </View>
      )}

      {profile?.character && (
        <View style={styles.group}>
          <SectionLabel>{t('char.section')}</SectionLabel>
          <Glass style={styles.charCard}>
            <View style={!universe && styles.away}>
              <Avatar character={profile.character} gender={profile.gender ?? 'm'} size={72} />
            </View>
            <View style={styles.charText}>
              <Text style={[styles.charName, { color: worldColor(profile.character, scheme) }]} numberOfLines={1}>
                {characterName(profile.character, settings.lang)}
              </Text>
              <Text style={[styles.hint, { color: colors.muted }]} numberOfLines={2}>
                {t(CHARACTERS[profile.character].text.role)}
              </Text>
            </View>
          </Glass>
          <Text style={[styles.subLabel, { color: colors.text }]}>{t('char.appearance')}</Text>
          <GenderToggle value={profile.gender} onChange={pickGender} disabled={genderLocked || genderBusy} />
          <Text style={[styles.hint, { color: colors.faint }]}>
            {genderLocked ? tf('char.genderNext', { date: formatWhen(genderFreeAt) }) : t('char.appearanceNote')}
          </Text>
          {universe ? (
            <>
              <Button
                variant={leaveArmed ? 'down' : 'ghost'}
                label={leaveArmed ? t('char.tapConfirm') : t('uni.leave')}
                onPress={async () => {
                  if (!leaveArmed) return setLeaveArmed(true);
                  setLeaveArmed(false);
                  try {
                    await leaveUniverse();
                  } catch {
                    notify(t('net.error'));
                  }
                }}
              />
              <Text style={[styles.hint, { color: colors.faint }]}>{tf('uni.leaveNote', { price: fmt(UNIVERSE_RETURN_COST) })}</Text>
              <Button variant="ghost" label={t('char.change')} onPress={onCharacter} />
            </>
          ) : (
            <>
              <Text style={[styles.hint, { color: colors.muted }]}>{t('uni.outside')}</Text>
              <Button label={tf('uni.backFor', { price: fmt(UNIVERSE_RETURN_COST) })} onPress={onCharacter} />
            </>
          )}
        </View>
      )}

      <View style={styles.group}>
        <SectionLabel>{t('settings.nickname')}</SectionLabel>
        <TextInput
          value={nick}
          onChangeText={setNick}
          onBlur={saveNick}
          onSubmitEditing={saveNick}
          maxLength={NICKNAME_MAX}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]}
          placeholderTextColor={colors.faint}
        />
        <Text style={[styles.hint, { color: nickError ? colors.down : colors.faint }]}>{t(nickError ?? 'settings.nicknameRule')}</Text>
      </View>

      <View style={styles.group}>
        <SectionLabel>{t('settings.theme')}</SectionLabel>
        {universe && <Text style={[styles.hint, { color: colors.faint }]}>{t('uni.themeNote')}</Text>}
        <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.line, opacity: universe ? 0.45 : 1 }]} pointerEvents={universe ? 'none' : 'auto'}>
          {THEMES.map((mode) => {
            const active = settings.theme === mode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptic('tap');
                  setTheme(mode);
                }}
                style={[styles.segmentItem, active && { backgroundColor: colors.gold }]}
              >
                <Text style={[styles.segmentText, { color: active ? colors.goldInk : colors.text }]} numberOfLines={1}>
                  {t(THEME_LABEL[mode])}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.rowText, { color: colors.text }]}>{t('settings.haptics')}</Text>
        <Switch
          value={settings.haptics}
          onValueChange={setHaptics}
          trackColor={{ false: colors.line, true: colors.gold }}
          thumbColor="#FFFFFF"
          {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
        />
      </View>

      <View style={styles.group}>
        <SectionLabel>{t('settings.language')}</SectionLabel>
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {LANGUAGES.map((lang, i) => {
            const active = settings.lang === lang.code;
            return (
              <Pressable
                key={lang.code}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptic('tap');
                  setLang(lang.code);
                }}
                style={({ pressed }) => [
                  styles.langRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
                  pressed && { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>{lang.name}</Text>
                <Text style={[styles.code, { color: colors.faint }]}>{lang.code.toUpperCase()}</Text>
                <View style={styles.check}>{active && <CheckIcon color={colors.goldText} />}</View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.about, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}>
        <View style={styles.aboutHead}>
          <AbieCoin size={28} color={colors.coin} ink={colors.coinInk} />
          <Text style={[tp.title, { color: colors.text }]}>{t('settings.aboutTitle')}</Text>
        </View>
        <Text style={[tp.body, { color: colors.text }]}>{t('settings.aboutText')}</Text>
      </View>

      <View style={styles.group}>
        <SectionLabel>{t('dev.title')}</SectionLabel>
        <Text style={[styles.hint, { color: colors.faint }]}>{t('dev.note')}</Text>
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.devRow}>
            <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>{t('dev.latency')}</Text>
            <Switch
              value={net.latency}
              onValueChange={(v) => setNet({ latency: v })}
              trackColor={{ false: colors.line, true: colors.gold }}
              thumbColor="#FFFFFF"
              {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
            />
          </View>
          <View style={[styles.devRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}>
            <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>{t('dev.failures')}</Text>
            <Switch
              value={net.failures}
              onValueChange={(v) => setNet({ failures: v })}
              trackColor={{ false: colors.line, true: colors.gold }}
              thumbColor="#FFFFFF"
              {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
            />
          </View>
        </View>
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.devRow}>
            <Text style={[styles.rowText, { color: colors.text, flex: 1 }]}>{t('dev.sparring')}</Text>
            <Switch
              value={sparring}
              onValueChange={setSparring}
              trackColor={{ false: colors.line, true: colors.gold }}
              thumbColor="#FFFFFF"
              {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
            />
          </View>
        </View>
        <Button
          variant="ghost"
          label={t('dev.grant')}
          onPress={async () => {
            await grantTest(1000);
            notify(t('dev.granted'));
          }}
        />
        <Button variant="ghost" label={t('dev.moderation')} onPress={onModeration} />
        <Button variant="ghost" label={t('dev.inbox')} onPress={onInbox} />
        <Button
          variant={resetArmed ? 'down' : 'ghost'}
          label={resetArmed ? t('dev.resetConfirm') : t('dev.reset')}
          onPress={async () => {
            if (!resetArmed) {
              setResetArmed(true);
              return;
            }
            setResetArmed(false);
            await resetServer();
            notify(t('dev.reset'));
          }}
        />
      </View>
    </ScrollView>
  );
}

const baseStyles = StyleSheet.create({
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xl * 2 },
  group: { gap: space.sm },
  input: { height: 48, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 16, fontWeight: '600' },
  segment: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 4, gap: 4 },
  segmentItem: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentText: { fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    minHeight: 56,
  },
  rowText: { fontSize: 16, fontWeight: '600' },
  list: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 50 },
  code: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  check: { width: 20, alignItems: 'center' },
  about: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.sm },
  aboutHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hint: { fontSize: 13 },
  away: { opacity: 0.45 },
  charCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg },
  charText: { flex: 1, gap: 2 },
  charName: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30 },
  subLabel: { fontSize: 15, fontWeight: '600', marginTop: space.sm },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 50 },
  idProvider: { width: 84, fontSize: 13, fontWeight: '700' },
  devRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 52 },
});
