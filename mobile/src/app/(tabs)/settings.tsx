import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Caps, Display, ErrorNote, Italic, Ornament, Rule } from '@/components/ui';
import { api, getBase, money, setBase, tokens } from '@/api';
import { APP_NAME, colors, fonts } from '@/theme';

const KIND_LABEL: Record<string, string> = {
  scan: 'Book Finder scans',
  chat: 'Librarian questions',
  catalogue: 'Catalogued photos',
};

export default function Settings() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [health, setHealth] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setUrl(await getBase());
    try {
      const [h, u, a] = await Promise.all([api.health(), api.usage(), api.audit()]);
      setHealth(h);
      setUsage(u);
      setAudit(a.reverse());
      setError('');
    } catch (e: any) {
      setHealth(null);
      setError(e.message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const save = async () => {
    await setBase(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    load();
  };

  const spent = usage?.spend_today_usd ?? 0;
  const budget = usage?.budget_usd ?? 0.5;
  const pct = Math.min(1, spent / budget);

  return (
    <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ paddingTop: insets.top + 18, paddingHorizontal: 20, paddingBottom: 60 }}>
      <Caps>{APP_NAME}</Caps>
      <Display>Settings</Display>

      <Section title="Library server">
        <Italic style={{ fontSize: 15 }}>Where the agents live. On a phone, use your computer’s address.</Italic>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.1.10:8020"
          placeholderTextColor={colors.sepiaSoft}
          style={s.input}
          accessibilityLabel="Server address"
        />
        <Button label={saved ? 'Saved' : 'Save & reconnect'} onPress={save} style={{ marginTop: 10 }} />
        {health ? (
          <Caps style={{ marginTop: 10, color: colors.inkSoft }}>
            {`Connected · ${health.model} · via ${health.providers.join(' → ')}`}
          </Caps>
        ) : (
          !!error && <ErrorNote message={error} />
        )}
      </Section>

      <Section title="The ledger · tokens & cost">
        <View style={s.meter}>
          <View style={[s.meterFill, { width: `${pct * 100}%`, backgroundColor: pct > 0.8 ? colors.danger : colors.gold }]} />
        </View>
        <Caps style={{ marginTop: 6 }}>{`Today ${money(spent)} of ${money(budget)} daily budget`}</Caps>
        {(usage?.by_kind || []).map((k: any) => (
          <View key={k.kind} style={s.ledgerRow}>
            <Text style={s.ledgerLabel}>{KIND_LABEL[k.kind] || k.kind}</Text>
            <Text style={s.ledgerVal}>
              {k.n} · {tokens((k.i || 0) + (k.o || 0))} tok · {money(k.usd || 0)}
            </Text>
          </View>
        ))}
        <Italic style={{ fontSize: 14, marginTop: 8 }}>
          Every agent runs on gpt-6-luna. Repeat shelves come from the cache for free; the Curator only runs when there is
          something to rank.
        </Italic>
      </Section>

      <Section title="Safety log">
        <Italic style={{ fontSize: 15, marginBottom: 6 }}>
          Text printed on books is treated as data. Suspicious spines are flagged and kept away from the Curator; agents can
          only add to your wishlist.
        </Italic>
        {audit
          .filter((a) => ['scan', 'blocked', 'suspicious_chat', 'mcp_write', 'error'].includes(a.kind))
          .slice(0, 8)
          .map((a, i) => (
            <View key={i} style={s.ledgerRow}>
              <Text style={s.ledgerLabel}>
                {a.kind === 'scan' ? (a.cached ? 'Scan (cached)' : 'Scan') : a.kind.replace('_', ' ')}
                {a.flagged?.length ? ' · ⚠ flagged' : ''}
              </Text>
              <Text style={s.ledgerVal}>{String(a.timestamp || '').slice(11, 16)}</Text>
            </View>
          ))}
      </Section>

      <Section title="Linked accounts">
        <Italic style={{ fontSize: 15 }}>Goodreads, Libby and Libib import — coming next (CSV export import).</Italic>
      </Section>

      <Ornament />
      <Italic style={{ textAlign: 'center', fontSize: 13 }}>Book data from Open Library.</Italic>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 26 }}>
      <Caps style={{ color: colors.ink, marginBottom: 8 }}>{title}</Caps>
      <Rule style={{ marginBottom: 10 }} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  input: {
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    marginTop: 8,
  },
  meter: { height: 4, backgroundColor: colors.paperDeep, marginTop: 4 },
  meterFill: { height: 4 },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  ledgerLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  ledgerVal: { fontFamily: fonts.bodyItalic, fontSize: 14, color: colors.sepia },
});
