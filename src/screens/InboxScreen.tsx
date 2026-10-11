import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { InboxMessage, server } from '../mock-server';
import { useStore } from '../state/store';
import { TopBar } from '../ui/kit';
import { radius, space, type } from '../ui/theme';

function clock(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Emails the server "sent". Stands in for the player's real mailbox. */
export function InboxScreen({ onBack }: { onBack: () => void }) {
  const { colors, t, tf } = useStore();
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  useEffect(() => {
    server.dev.inbox().then(setMessages);
    return server.dev.onInbox(() => server.dev.inbox().then(setMessages));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TopBar title={t('inbox.title')} onBack={onBack} />
      <Text style={[styles.note, { color: colors.faint }]}>{t('auth.simNote')}</Text>
      {messages.length === 0 && <Text style={[type.body, { color: colors.muted }]}>{t('inbox.empty')}</Text>}
      {messages.map((m) => (
        <View key={m.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.head}>
            <Text style={[styles.subject, { color: colors.text }]} numberOfLines={1}>
              {t('inbox.codeSubject')}
            </Text>
            <Text style={[styles.time, { color: colors.faint }]}>{clock(m.ts)}</Text>
          </View>
          <Text style={[styles.to, { color: colors.muted }]}>{m.to}</Text>
          <Text style={[type.body, { color: colors.text }]}>{tf('inbox.codeBody', { code: m.code })}</Text>
          <Text style={[styles.code, { color: colors.gold }]} selectable>
            {m.code}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  note: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  subject: { flex: 1, fontSize: 16, fontWeight: '700' },
  time: { fontSize: 12, ...type.num },
  to: { fontSize: 13 },
  code: { fontSize: 30, fontWeight: '900', letterSpacing: 6, marginTop: space.sm, ...type.num },
});
