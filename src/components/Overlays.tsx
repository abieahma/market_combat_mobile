import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { InboxMessage, server } from '../mock-server';
import { useStore } from '../state/store';
import { radius, space, type } from '../ui/theme';
import { useLookStyles } from '../ui/look';

/** Short message at the bottom of the screen (errors, confirmations). */
export function Toast() {
  const styles = useLookStyles(baseStyles);
  const { colors, toast } = useStore();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.toast, { backgroundColor: colors.text }]}>
      <Text style={[styles.toastText, { color: colors.bg }]}>{toast}</Text>
    </View>
  );
}

/** "New email" banner, like a phone notification from the mail app. */
export function InboxBanner({ onOpen }: { onOpen: () => void }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t } = useStore();
  const [msg, setMsg] = useState<InboxMessage | null>(null);

  useEffect(() => server.dev.onInbox(setMsg), []);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(id);
  }, [msg]);

  if (!msg) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setMsg(null);
        onOpen();
      }}
      style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}
    >
      <Text style={[styles.bannerTitle, { color: colors.muted }]}>
        {t('inbox.new')} · {msg.to}
      </Text>
      <Text style={[styles.bannerBody, { color: colors.text }]} numberOfLines={1}>
        {t('inbox.codeSubject')}: <Text style={[styles.code, { color: colors.goldText }]}>{msg.code}</Text>
      </Text>
    </Pressable>
  );
}

const baseStyles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: space.xl * 1.5,
    alignSelf: 'center',
    maxWidth: '90%',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  toastText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  banner: {
    position: 'absolute',
    top: space.sm,
    left: space.md,
    right: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerTitle: { fontSize: 12, fontWeight: '700' },
  bannerBody: { fontSize: 15, fontWeight: '600' },
  code: { fontWeight: '900', letterSpacing: 2, ...type.num },
});
