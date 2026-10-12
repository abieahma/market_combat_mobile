// Game proposals: an author sends an idea (not code), talks with the
// moderator and, once it is approved, the game enters the platform registry.

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CHARACTER_IDS,
  CharacterId,
  Offer,
  Proposal,
  PROPOSAL_DESCRIPTION_MIN,
  PROPOSAL_TITLE_MAX,
  PROPOSAL_TITLE_MIN,
  ProposalDraft,
  ProposalStatus,
} from '../api/contract';
import { isApiError } from '../api/transport';
import { formatWhen, StringKey } from '../i18n/strings';
import { api, requestId, useStore } from '../state/store';
import { CheckIcon } from '../ui/icons';
import { Button, SectionLabel, TopBar } from '../ui/kit';
import { Glass, LiftPressable } from '../ui/luxe';
import { fonts, radius, space, type } from '../ui/theme';
import { characterName } from '../world/characters';

const STATUS_LABEL: Record<ProposalStatus, StringKey> = {
  review: 'prop.status.review',
  changes_requested: 'prop.status.changes_requested',
  approved: 'prop.status.approved',
  rejected: 'prop.status.rejected',
};

export function StatusPill({ status }: { status: ProposalStatus }) {
  const { colors, t } = useStore();
  const color = { review: colors.gold, changes_requested: colors.down, approved: colors.up, rejected: colors.faint }[status];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{t(STATUS_LABEL[status])}</Text>
    </View>
  );
}

// ----------------------------------------------------------------- list

export function ProposalsScreen({ onBack, onNew, onOpen }: { onBack: () => void; onNew: () => void; onOpen: (id: string) => void }) {
  const { colors, t } = useStore();
  const [items, setItems] = useState<Proposal[] | null>(null);

  useEffect(() => {
    api.proposals
      .list()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <TopBar title={t('prop.title')} onBack={onBack} />
      <Text style={[type.body, { color: colors.muted }]}>{t('prop.lead')}</Text>
      <Button label={t('prop.new')} onPress={onNew} big />
      {items === null && <ActivityIndicator color={colors.gold} />}
      {items?.length === 0 && <Text style={[type.body, { color: colors.faint, textAlign: 'center' }]}>{t('prop.empty')}</Text>}
      {items?.map((p) => (
        <LiftPressable key={p.id} onPress={() => onOpen(p.id)} accessibilityLabel={p.title}>
          <Glass style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {p.title}
              </Text>
              <StatusPill status={p.status} />
            </View>
            <Text style={[styles.small, { color: colors.faint }]}>{formatWhen(p.updatedAt)}</Text>
          </Glass>
        </LiftPressable>
      ))}
    </ScrollView>
  );
}

// ----------------------------------------------------------------- form

const EMPTY: ProposalDraft = { title: '', description: '', universes: 'all', currency: null, entry: { kind: 'free' } };

/** A whole number from a text field, or NaN. */
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

export function ProposalFormScreen({ proposal, onBack, onDone }: { proposal?: Proposal; onBack: () => void; onDone: (p: Proposal) => void }) {
  const { colors, t, settings, notify, haptic } = useStore();
  const start = proposal ?? EMPTY;
  const [title, setTitle] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const [universes, setUniverses] = useState<CharacterId[] | 'all'>(start.universes);
  const [hasCurrency, setHasCurrency] = useState(!!start.currency);
  const [code, setCode] = useState(start.currency?.code ?? '');
  const [rateAbie, setRateAbie] = useState(String(start.currency?.rate.abie ?? 1));
  const [rateUnits, setRateUnits] = useState(String(start.currency?.rate.units ?? 10));
  const [share, setShare] = useState(String(start.currency?.authorShare ?? 10));
  const [paid, setPaid] = useState(start.entry.kind === 'paid');
  const [price, setPrice] = useState(start.entry.kind === 'paid' ? String(start.entry.price) : '10');
  const [offer, setOffer] = useState<Offer | null>(null);
  const [showOffer, setShowOffer] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key] = useState(requestId);

  useEffect(() => {
    if (proposal) return; // changes to a proposal keep the offer accepted with it
    api.proposals
      .offer(settings.lang)
      .then(setOffer)
      .catch(() => setOffer(null));
  }, [proposal, settings.lang]);

  const toggleUniverse = (u: CharacterId | 'all') => {
    haptic('tap');
    if (u === 'all') return setUniverses('all');
    const current = universes === 'all' ? [] : universes;
    const next = current.includes(u) ? current.filter((x) => x !== u) : [...current, u];
    setUniverses(next.length === 0 ? 'all' : next);
  };

  const draft = (): ProposalDraft | null => {
    const tl = title.trim();
    if (tl.length < PROPOSAL_TITLE_MIN || tl.length > PROPOSAL_TITLE_MAX || description.trim().length < PROPOSAL_DESCRIPTION_MIN) return null;
    let currency: ProposalDraft['currency'] = null;
    if (hasCurrency) {
      const a = whole(rateAbie);
      const u = whole(rateUnits);
      const sh = whole(share);
      if (!/^[A-Za-z0-9]{2,8}$/.test(code.trim()) || !(a >= 1) || !(u >= 1) || !(sh >= 0 && sh <= 100)) return null;
      currency = { code: code.trim().toUpperCase(), rate: { abie: a, units: u }, authorShare: sh };
    }
    const pr = whole(price);
    if (paid && !(pr >= 1)) return null;
    return { title: tl, description: description.trim(), universes, currency, entry: paid ? { kind: 'paid', price: pr } : { kind: 'free' } };
  };

  const submit = async () => {
    const d = draft();
    setError(!d);
    if (!d) return;
    setBusy(true);
    try {
      const p = proposal ? await api.proposals.update(proposal.id, d) : await api.proposals.create(d, offer!.version, key);
      haptic('success');
      notify(t('prop.sent'));
      onDone(p);
    } catch (e) {
      if (isApiError(e) && e.code === 'invalid_input') setError(true);
      else notify(t('net.error'));
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }];

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar title={proposal ? t('prop.edit') : t('prop.new')} onBack={onBack} />

      <Field label={t('prop.name')}>
        <TextInput value={title} onChangeText={setTitle} maxLength={PROPOSAL_TITLE_MAX} style={input} placeholderTextColor={colors.faint} />
      </Field>

      <Field label={t('prop.idea')} hint={t('prop.ideaHint')}>
        <TextInput value={description} onChangeText={setDescription} multiline maxLength={2000} style={[input, styles.area]} textAlignVertical="top" />
      </Field>

      <Field label={t('prop.universes')}>
        <View style={styles.chips}>
          <Chip label={t('prop.all')} active={universes === 'all'} onPress={() => toggleUniverse('all')} />
          {CHARACTER_IDS.map((c) => (
            <Chip key={c} label={characterName(c, settings.lang)} active={universes !== 'all' && universes.includes(c)} onPress={() => toggleUniverse(c)} />
          ))}
        </View>
      </Field>

      <Field label={t('prop.currency')}>
        <Segment options={[t('prop.noCurrency'), t('prop.withCurrency')]} value={hasCurrency ? 1 : 0} onChange={(i) => setHasCurrency(i === 1)} />
        {hasCurrency && (
          <View style={styles.sub}>
            <Text style={[styles.small, { color: colors.muted }]}>{t('prop.code')}</Text>
            <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={8} style={input} placeholder="QZ" placeholderTextColor={colors.faint} />
            <Text style={[styles.small, { color: colors.muted }]}>{t('prop.rate')}</Text>
            <View style={styles.rateRow}>
              <TextInput value={rateAbie} onChangeText={setRateAbie} keyboardType="number-pad" style={[input, styles.rateInput]} />
              <Text style={[styles.rateSign, { color: colors.gold }]}>ABIE =</Text>
              <TextInput value={rateUnits} onChangeText={setRateUnits} keyboardType="number-pad" style={[input, styles.rateInput]} />
              <Text style={[styles.rateSign, { color: colors.gold }]}>{code.trim().toUpperCase() || '…'}</Text>
            </View>
            <Text style={[styles.small, { color: colors.faint }]}>{t('prop.rateHint')}</Text>
            <Text style={[styles.small, { color: colors.muted }]}>{t('prop.share')}</Text>
            <TextInput value={share} onChangeText={setShare} keyboardType="number-pad" maxLength={3} style={[input, styles.rateInput]} />
          </View>
        )}
      </Field>

      <Field label={t('prop.entry')}>
        <Segment options={[t('prop.free'), t('prop.paid')]} value={paid ? 1 : 0} onChange={(i) => setPaid(i === 1)} />
        {paid && (
          <View style={styles.sub}>
            <Text style={[styles.small, { color: colors.muted }]}>{t('prop.price')}</Text>
            <TextInput value={price} onChangeText={setPrice} keyboardType="number-pad" style={[input, styles.rateInput]} />
            <Text style={[styles.small, { color: colors.faint }]}>{t('prop.priceHint')}</Text>
          </View>
        )}
      </Field>

      {!proposal && (
        <Glass quiet style={styles.offer}>
          <Text style={[styles.offerTitle, { color: colors.text }]}>{offer?.title ?? t('prop.offer')}</Text>
          {offer === null && <ActivityIndicator color={colors.gold} />}
          {offer && (
            <>
              <Pressable accessibilityRole="button" onPress={() => setShowOffer((v) => !v)}>
                <Text style={[styles.link, { color: colors.gold }]}>{showOffer ? t('prop.offerHide') : t('prop.offerShow')}</Text>
              </Pressable>
              {showOffer && offer.paragraphs.map((p, i) => <Text key={i} style={[styles.offerText, { color: colors.muted }]}>{p}</Text>)}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: accepted }}
                onPress={() => {
                  haptic('tap');
                  setAccepted((v) => !v);
                }}
                style={styles.accept}
              >
                <View style={[styles.box, { borderColor: colors.gold, backgroundColor: accepted ? colors.gold : 'transparent' }]}>
                  {accepted && <CheckIcon size={14} color={colors.goldInk} />}
                </View>
                <Text style={[type.body, { color: colors.text, flex: 1 }]}>{t('prop.offerAccept')}</Text>
              </Pressable>
            </>
          )}
        </Glass>
      )}

      {error && <Text style={[styles.small, { color: colors.down }]}>{t('prop.invalid')}</Text>}
      <Button label={proposal ? t('prop.resend') : t('prop.send')} onPress={submit} big disabled={busy || (!proposal && (!offer || !accepted))} />
    </ScrollView>
  );
}

// --------------------------------------------------------------- detail

export function ProposalScreen({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: (p: Proposal) => void }) {
  const { colors, t, tf, fmt, settings, notify } = useStore();
  const [p, setP] = useState<Proposal | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.proposals
      .get(id)
      .then(setP)
      .catch(() => notify(t('net.error')));
  }, [id, notify, t]);
  useEffect(load, [load]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setP(await api.proposals.message(id, text));
      setText('');
    } catch {
      notify(t('net.error'));
    } finally {
      setBusy(false);
    }
  };

  if (!p) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const universes = p.universes === 'all' ? t('prop.all') : p.universes.map((u) => characterName(u, settings.lang)).join(', ');

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <TopBar title={p.title} onBack={onBack} />
      <StatusPill status={p.status} />
      {p.status === 'approved' && <Text style={[type.body, { color: colors.up }]}>{t('prop.approvedNote')}</Text>}
      <Glass quiet style={styles.summary}>
        <Text style={[type.body, { color: colors.text }]}>{p.description}</Text>
        <Row label={t('prop.universes')} value={universes} />
        <Row
          label={t('prop.currency')}
          value={p.currency ? `${p.currency.code} · ${fmt(p.currency.rate.abie)} ABIE = ${fmt(p.currency.rate.units)} ${p.currency.code} · ${p.currency.authorShare}%` : t('prop.noCurrency')}
        />
        <Row label={t('prop.entry')} value={p.entry.kind === 'paid' ? tf('entry.price', { price: fmt(p.entry.price) }) : t('prop.free')} />
      </Glass>
      {p.status === 'changes_requested' && <Button label={t('prop.edit')} onPress={() => onEdit(p)} />}

      <SectionLabel>{t('prop.messages')}</SectionLabel>
      {p.messages.map((m) => (
        <View
          key={m.id}
          style={[
            styles.message,
            m.from === 'author' ? { alignSelf: 'flex-end', backgroundColor: colors.goldSoft } : { alignSelf: 'flex-start', backgroundColor: colors.surface },
            { borderColor: colors.line },
          ]}
        >
          <Text style={[styles.small, { color: colors.faint }]}>
            {m.from === 'author' ? t('prop.you') : t('prop.moderator')} · {formatWhen(m.ts)}
          </Text>
          <Text style={[type.body, { color: colors.text }]}>{m.text}</Text>
        </View>
      ))}
      {p.status !== 'approved' && p.status !== 'rejected' && (
        <View style={styles.compose}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('prop.message')}
            placeholderTextColor={colors.faint}
            multiline
            maxLength={1000}
            style={[styles.input, styles.composeInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]}
          />
          <Button label={t('prop.sendMessage')} onPress={send} disabled={busy || !text.trim()} />
        </View>
      )}
    </ScrollView>
  );
}

// ------------------------------------------------------------- pieces

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const { colors } = useStore();
  return (
    <View style={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      {hint && <Text style={[styles.small, { color: colors.faint }]}>{hint}</Text>}
      {children}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useStore();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? colors.gold : colors.line, backgroundColor: active ? colors.goldSoft : 'transparent' }]}
    >
      <Text style={[styles.chipText, { color: active ? colors.gold : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Segment({ options, value, onChange }: { options: string[]; value: number; onChange: (i: number) => void }) {
  const { colors, haptic } = useStore();
  return (
    <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {options.map((o, i) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          accessibilityState={{ selected: value === i }}
          onPress={() => {
            haptic('tap');
            onChange(i);
          }}
          style={[styles.segmentItem, value === i && { backgroundColor: colors.gold }]}
        >
          <Text style={[styles.segmentText, { color: value === i ? colors.goldInk : colors.text }]} numberOfLines={1}>
            {o}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useStore();
  return (
    <View style={styles.row}>
      <Text style={[styles.small, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  card: { padding: space.lg, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { flex: 1, fontFamily: fonts.displaySemi, fontSize: 22 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  small: { fontSize: 13 },
  field: { gap: space.sm },
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 16 },
  area: { minHeight: 120, paddingTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 14, fontWeight: '600' },
  segment: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 4, gap: 4 },
  segmentItem: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentText: { fontSize: 14, fontWeight: '700' },
  sub: { gap: space.sm, marginTop: space.xs },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rateInput: { width: 90, textAlign: 'center' },
  rateSign: { fontSize: 15, fontWeight: '700' },
  offer: { padding: space.lg, gap: space.sm },
  offerTitle: { fontFamily: fonts.displaySemi, fontSize: 20 },
  offerText: { fontSize: 13, lineHeight: 19 },
  link: { fontSize: 14, fontWeight: '700' },
  accept: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  summary: { padding: space.lg, gap: space.md },
  row: { gap: 2 },
  rowValue: { fontSize: 15, fontWeight: '600' },
  message: { maxWidth: '88%', borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
  compose: { gap: space.sm },
  composeInput: { minHeight: 70, paddingTop: space.md },
});
