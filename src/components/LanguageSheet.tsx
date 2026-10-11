import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LANGUAGES } from '../i18n/strings';
import { useStore } from '../state/store';
import { CheckIcon } from '../ui/icons';
import { SectionLabel } from '../ui/kit';
import { space } from '../ui/theme';
import { Sheet } from './Sheet';

export function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, t, settings, setLang, haptic } = useStore();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SectionLabel>{t('settings.language')}</SectionLabel>
      <ScrollView>
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
                onClose();
              }}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
                pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Text style={[styles.name, { color: colors.text }]}>{lang.name}</Text>
              <View style={styles.check}>{active && <CheckIcon color={colors.gold} />}</View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: space.sm },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  check: { width: 24, alignItems: 'center' },
});
