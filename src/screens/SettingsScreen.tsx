import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { LANGUAGES, StringKey } from '../i18n/strings';
import { NICKNAME_MAX, useStore } from '../state/store';
import { AbieCoin, CheckIcon } from '../ui/icons';
import { SectionLabel, TopBar } from '../ui/kit';
import { radius, space, ThemeMode, type } from '../ui/theme';

const THEMES: ThemeMode[] = ['system', 'dark', 'light'];
const THEME_LABEL: Record<ThemeMode, StringKey> = { system: 'theme.system', dark: 'theme.dark', light: 'theme.light' };

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { colors, t, settings, profile, setLang, setTheme, setHaptics, setNickname, haptic } = useStore();
  const [nick, setNick] = useState(profile.nickname);
  useEffect(() => setNick(profile.nickname), [profile.nickname]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar title={t('settings.title')} onBack={onBack} />

      <View style={styles.group}>
        <SectionLabel>{t('settings.nickname')}</SectionLabel>
        <TextInput
          value={nick}
          onChangeText={setNick}
          onBlur={() => setNickname(nick)}
          onSubmitEditing={() => setNickname(nick)}
          maxLength={NICKNAME_MAX}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]}
          placeholderTextColor={colors.faint}
        />
      </View>

      <View style={styles.group}>
        <SectionLabel>{t('settings.theme')}</SectionLabel>
        <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.line }]}>
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
                <View style={styles.check}>{active && <CheckIcon color={colors.gold} />}</View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.about, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}>
        <View style={styles.aboutHead}>
          <AbieCoin size={28} color={colors.gold} ink={colors.coinInk} />
          <Text style={[type.title, { color: colors.text }]}>{t('settings.aboutTitle')}</Text>
        </View>
        <Text style={[type.body, { color: colors.text }]}>{t('settings.aboutText')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
