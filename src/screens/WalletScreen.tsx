import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TxKind, WalletTx } from '../api/contract';
import { formatWhen as when, StringKey } from '../i18n/strings';
import { api, useStore } from '../state/store';
import { AbieCoin } from '../ui/icons';
import { Button, SectionLabel, TopBar } from '../ui/kit';
import { radius, space } from '../ui/theme';
import { useLookStyles, useType } from '../ui/look';

const KIND_LABEL: Record<TxKind, StringKey> = {
  welcome: 'tx.welcome',
  match_reward: 'tx.match_reward',
  character_change: 'tx.character_change',
  currency_buy: 'tx.currency_buy',
  currency_return: 'tx.currency_return',
  currency_sale: 'tx.currency_sale',
  currency_payout: 'tx.currency_payout',
  entry_buy: 'tx.entry_buy',
  entry_fee: 'tx.entry_fee',
  entry_income: 'tx.entry_income',
  author_share: 'tx.author_share',
  kombat_boost: 'tx.kombat_boost',
  universe_return: 'tx.universe_return',
  deposit: 'tx.deposit',
  test_grant: 'tx.test_grant',
};

export function WalletScreen({ onBack }: { onBack: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, fmt, balance, refresh } = useStore();
  const [items, setItems] = useState<WalletTx[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (from: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await api.wallet.transactions(from, 20);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    load(null);
  }, [load, refresh]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TopBar title={t('wallet.title')} onBack={onBack} />

      <View style={[styles.hero, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}>
        <Text style={[tp.label, { color: colors.goldText }]}>{t('wallet.balance')}</Text>
        <View style={styles.amountRow}>
          <AbieCoin size={36} color={colors.coin} ink={colors.coinInk} />
          <Text style={[styles.amount, tp.num, { color: colors.text }]}>{fmt(balance)}</Text>
          <Text style={[styles.ticker, { color: colors.goldText }]}>ABIE</Text>
        </View>
      </View>

      <SectionLabel>{t('wallet.history')}</SectionLabel>
      <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {items.length === 0 && !loading && !failed && <Text style={[styles.empty, { color: colors.muted }]}>{t('wallet.empty')}</Text>}
        {items.map((tx, i) => (
          <View key={tx.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.kind, { color: colors.text }]} numberOfLines={1}>
                {t(KIND_LABEL[tx.kind])}
              </Text>
              <Text style={[styles.meta, tp.num, { color: colors.faint }]} numberOfLines={1}>
                {when(tx.ts)} · {tf('wallet.after', { amount: fmt(tx.balanceAfter) })}
              </Text>
            </View>
            <Text style={[styles.delta, tp.num, { color: tx.amount >= 0 ? colors.up : colors.down }]}>
              {tx.amount > 0 ? '+' : ''}
              {fmt(tx.amount)}
            </Text>
          </View>
        ))}
      </View>

      {loading && <ActivityIndicator color={colors.goldText} />}
      {failed && (
        <View style={styles.failRow}>
          <Text style={[tp.body, { color: colors.down, flex: 1 }]}>{t('net.error')}</Text>
          <Button variant="ghost" label={t('net.retry')} onPress={() => load(items.length ? cursor : null)} />
        </View>
      )}
      {cursor && !loading && !failed && <Button variant="ghost" label={t('wallet.more')} onPress={() => load(cursor)} />}
    </ScrollView>
  );
}

const baseStyles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  hero: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amount: { fontSize: 40, fontWeight: '900' },
  ticker: { fontSize: 14, fontWeight: '800', letterSpacing: 1, marginTop: 10 },
  list: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  empty: { padding: space.lg, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  kind: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12 },
  delta: { fontSize: 17, fontWeight: '800' },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
