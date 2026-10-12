// Developer panel: the platform moderator's side of game proposals. On the
// Go server this is a separate tool for moderators; in the stub it goes
// through `server.dev`.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Proposal, ProposalStatus } from '../api/contract';
import { formatWhen } from '../i18n/strings';
import { server } from '../mock-server';
import { useStore } from '../state/store';
import { Button, TopBar } from '../ui/kit';
import { Glass } from '../ui/luxe';
import { fonts, radius, space, type } from '../ui/theme';
import { characterName } from '../world/characters';
import { StatusPill } from './ProposalsScreen';

export function ModerationScreen({ onBack }: { onBack: () => void }) {
  const { colors, t, tf, fmt, settings, refresh, notify } = useStore();
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    server.dev
      .proposals()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const decide = async (p: Proposal, status: Exclude<ProposalStatus, 'review'>) => {
    try {
      await server.dev.moderate(p.id, status, notes[p.id]);
      setNotes((n) => ({ ...n, [p.id]: '' }));
      load();
      if (status === 'approved') refresh();
    } catch {
      notify(t('net.error'));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar title={t('dev.moderation')} onBack={onBack} />
      <Text style={[type.body, { color: colors.muted }]}>{t('dev.moderationNote')}</Text>
      {items === null && <ActivityIndicator color={colors.gold} />}
      {items?.length === 0 && <Text style={[type.body, { color: colors.faint }]}>{t('dev.noProposals')}</Text>}
      {items?.map((p) => {
        const open = p.status === 'review' || p.status === 'changes_requested';
        const universes = p.universes === 'all' ? t('prop.all') : p.universes.map((u) => characterName(u, settings.lang)).join(', ');
        return (
          <Glass key={p.id} style={styles.card}>
            <View style={styles.head}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                {p.title}
              </Text>
              <StatusPill status={p.status} />
            </View>
            <Text style={[styles.small, { color: colors.faint }]}>{formatWhen(p.updatedAt)}</Text>
            <Text style={[type.body, { color: colors.text }]}>{p.description}</Text>
            <Text style={[styles.small, { color: colors.muted }]}>
              {universes} ·{' '}
              {p.currency ? `${p.currency.code}: ${fmt(p.currency.rate.abie)} ABIE = ${fmt(p.currency.rate.units)} · ${p.currency.authorShare}%` : t('prop.noCurrency')} ·{' '}
              {p.entry.kind === 'paid' ? tf('entry.price', { price: fmt(p.entry.price) }) : t('prop.free')}
            </Text>
            {p.messages.map((m) => (
              <Text key={m.id} style={[styles.small, { color: m.from === 'moderator' ? colors.gold : colors.muted }]}>
                {m.from === 'moderator' ? t('prop.moderator') : t('prop.you')}: {m.text}
              </Text>
            ))}
            {open && (
              <>
                <TextInput
                  value={notes[p.id] ?? ''}
                  onChangeText={(v) => setNotes((n) => ({ ...n, [p.id]: v }))}
                  placeholder={t('prop.message')}
                  placeholderTextColor={colors.faint}
                  multiline
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]}
                />
                <View style={styles.actions}>
                  <Button label={t('dev.approve')} onPress={() => decide(p, 'approved')} style={styles.action} />
                  <Button label={t('dev.changes')} variant="ghost" onPress={() => decide(p, 'changes_requested')} style={styles.action} />
                  <Button label={t('dev.reject')} variant="ghost" onPress={() => decide(p, 'rejected')} style={styles.action} />
                </View>
              </>
            )}
          </Glass>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  card: { padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 22 },
  small: { fontSize: 13 },
  input: { minHeight: 60, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, paddingTop: space.sm, fontSize: 15 },
  actions: { gap: space.sm },
  action: { minHeight: 44 },
});
