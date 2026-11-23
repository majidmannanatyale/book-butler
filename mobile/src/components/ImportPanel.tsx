// Bring a whole library in at once from Goodreads or Libib (their CSV exports).
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button, Caps, ErrorNote, Italic, tap } from '@/components/ui';
import { api } from '@/api';
import { colors, fonts } from '@/theme';

let Picker: any = null;
let FSFile: any = null;
try {
  Picker = require('expo-document-picker');
  FSFile = require('expo-file-system').File;
} catch {
  Picker = null; // older build: paste box only
}

async function readPicked(): Promise<string | null> {
  const res = await Picker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  if (Platform.OS === 'web' && a.file) return await a.file.text();
  return await new FSFile(a.uri).text();
}

export default function ImportPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(!Picker);
  const [result, setResult] = useState<null | { source: string; rows: number; added: number; skipped_duplicates: number; wishlist: number; sample: string[] }>(null);

  const run = async (csv: string) => {
    setBusy(true);
    setError('');
    try {
      setResult(await api.importCsv(csv));
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  const pick = async () => {
    tap();
    try {
      const text = await readPicked();
      if (text) await run(text);
    } catch (e: any) {
      setError(e?.message || 'Could not read that file.');
    }
  };

  if (result)
    return (
      <Animated.View entering={FadeIn}>
        <Text style={s.big}>{result.added}</Text>
        <Caps style={{ textAlign: 'center' }}>{`books brought in from ${result.source === 'libib' ? 'Libib' : result.source === 'goodreads' ? 'Goodreads' : 'your file'}`}</Caps>
        <Italic style={{ textAlign: 'center', marginTop: 8 }}>
          {`${result.rows} rows read · ${result.skipped_duplicates} already on your shelves · ${result.wishlist} to your wishlist`}
        </Italic>
        {!!result.sample.length && <Italic style={{ textAlign: 'center', fontSize: 14, marginTop: 6 }}>{`Including ${result.sample.slice(0, 4).join(', ')}…`}</Italic>}
        <Button label="See them on the bookcase" style={{ marginTop: 18 }} onPress={() => router.push('/library')} />
        <Button label="Import another" kind="outline" style={{ marginTop: 10 }} onPress={() => setResult(null)} />
      </Animated.View>
    );

  return (
    <View>
      <Italic style={{ marginBottom: 12 }}>Bring your whole library across in one go. Duplicates are skipped, "to-read" becomes your wishlist, covers come from the ISBN.</Italic>
      <View style={s.how}>
        <Caps style={{ color: colors.ink }}>From Goodreads</Caps>
        <Text style={s.step}>My Books → Import and export → Export Library → download the CSV.</Text>
        <Caps style={{ color: colors.ink, marginTop: 10 }}>From Libib</Caps>
        <Text style={s.step}>Settings → Export Library → choose your library → download the CSV.</Text>
      </View>
      {Picker && <Button label="Choose the CSV file" busy={busy} onPress={pick} style={{ marginTop: 16 }} />}
      {!!error && <ErrorNote message={error} />}
      {Picker && !showPaste && (
        <Button label="Or paste the file's contents" kind="ghost" onPress={() => setShowPaste(true)} style={{ marginTop: 6 }} />
      )}
      {showPaste && (
        <View style={{ marginTop: 14 }}>
          <TextInput
            value={paste}
            onChangeText={setPaste}
            multiline
            placeholder="Paste the CSV here…"
            placeholderTextColor={colors.sepiaSoft}
            style={s.paste}
            accessibilityLabel="CSV contents"
          />
          <Button label="Import" busy={busy} disabled={paste.length < 20} onPress={() => run(paste)} style={{ marginTop: 10 }} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  how: { borderLeftWidth: 2, borderColor: colors.gold, paddingLeft: 12, paddingVertical: 4 },
  step: { fontFamily: fonts.bodyItalic, fontSize: 14.5, color: colors.inkSoft, marginTop: 2 },
  big: { fontFamily: fonts.displayLight, fontSize: 72, color: colors.gold, textAlign: 'center' },
  paste: { minHeight: 130, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 10, fontFamily: fonts.body, fontSize: 13, color: colors.ink, textAlignVertical: 'top' },
});
