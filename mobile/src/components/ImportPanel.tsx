// Bring a whole library in at once from Goodreads or Libib (their CSV exports).
import React, { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  Picker = null; // older build without the document picker
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
      <Italic style={{ marginBottom: 12 }}>
        Bring your whole library across in one go. Duplicates are skipped, "want to read" becomes your wishlist, covers come from the ISBN.
      </Italic>
      {SOURCES.map((src, i) => (
        <Animated.View key={src.name} entering={FadeIn.delay(i * 120)} style={s.card}>
          <Text style={s.src}>{src.name}</Text>
          <Text style={s.step}>{src.how}</Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            <Pressable onPress={() => { tap(); Linking.openURL(src.url); }} style={s.step1} accessibilityRole="link">
              <Caps style={{ color: colors.gold, textAlign: 'center' }}>{`1 · Get the file from ${src.name}`}</Caps>
            </Pressable>
            <Pressable
              onPress={Picker ? pick : () => setError('This build has no file picker — install the latest Book Butler build.')}
              style={[s.step1, s.step2]}
              accessibilityRole="button"
              disabled={busy}
            >
              <Caps style={{ color: colors.paper, textAlign: 'center' }}>{busy ? 'Importing…' : `2 · Import the ${src.name} CSV`}</Caps>
            </Pressable>
          </View>
        </Animated.View>
      ))}
      {!!error && <ErrorNote message={error} />}
      <Italic style={{ fontSize: 13, marginTop: 12 }}>
        Goodreads closed its public API and Libib has none, so the export file is the only way in. It never leaves your library server.
      </Italic>
    </View>
  );
}

const SOURCES = [
  { name: 'Goodreads', url: 'https://www.goodreads.com/review/import', how: 'Tap "Export Library", wait for the link, download the CSV.' },
  { name: 'Libib', url: 'https://www.libib.com/', how: 'Sign in → Settings → Export → choose your library → download the CSV.' },
];

const s = StyleSheet.create({
  card: { borderLeftWidth: 2, borderColor: colors.gold, paddingLeft: 12, paddingVertical: 6, marginTop: 12 },
  src: { fontFamily: fonts.display, fontSize: 21, color: colors.ink },
  step1: { borderWidth: 1, borderColor: 'rgba(242,181,58,0.6)', paddingVertical: 9, paddingHorizontal: 10 },
  step2: { backgroundColor: colors.gold, borderColor: colors.gold },
  step: { fontFamily: fonts.bodyItalic, fontSize: 14.5, color: colors.inkSoft, marginTop: 2 },
  big: { fontFamily: fonts.displayLight, fontSize: 72, color: colors.gold, textAlign: 'center' },
});
