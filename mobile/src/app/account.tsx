// Your account: sign in / create one (choosing what kind of reader you are),
// your profile and friend code, and your friends' bookcases.
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { IconClose } from '@/components/Icons';
import Logo from '@/components/Logo';
import { Button, Caps, Chip, ErrorNote, Italic, Ornament, Rule, tap } from '@/components/ui';
import { api, getToken, Profile, setToken, Stats } from '@/api';
import { colors, fonts } from '@/theme';

type RT = { key: string; label: string; blurb: string };

export default function Account() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [me, setMe] = useState<(Profile & { stats: Stats; signed_in: boolean }) | null>(null);
  const [friends, setFriends] = useState<(Profile & { books: number; reading_now: number })[]>([]);
  const [types, setTypes] = useState<RT[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([api.me(), api.readerTypes()]);
      setMe(m);
      setTypes(t);
      setFriends(await api.friends());
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const signedIn = !!me?.signed_in;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 22, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Logo size={34} />
            <Caps>The Book Butler</Caps>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
            <IconClose color={colors.ink} />
          </Pressable>
        </View>
        {!!error && <ErrorNote message={error} />}
        {me && !signedIn && <Auth types={types} onDone={load} />}
        {me && signedIn && <ProfileView me={me} types={types} friends={friends} onChange={load} />}
        {me && !signedIn && (
          <View style={{ marginTop: 26 }}>
            <Rule />
            <Italic style={{ fontSize: 14, marginTop: 12 }}>
              Not signed in, you're browsing the demo collection — with two demo friends, Sam and Ada.
            </Italic>
            <FriendsList friends={friends} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Auth({ types, onDone }: { types: RT[]; onDone: () => void }) {
  const [mode, setMode] = useState<'signin' | 'create'>('create');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [rt, setRt] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    tap();
    setBusy(true);
    setError('');
    try {
      const r = mode === 'create' ? await api.register({ username, password, display_name: name, reader_type: rt }) : await api.login(username, password);
      await setToken(r.token);
      onDone();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <Animated.View entering={FadeIn}>
      <Text style={s.h1}>{mode === 'create' ? 'Make yourself at home' : 'Welcome back'}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
        <Chip label="Create account" active={mode === 'create'} onPress={() => setMode('create')} />
        <Chip label="Sign in" active={mode === 'signin'} onPress={() => setMode('signin')} />
      </View>
      <Field label="Username" value={username} onChange={setUsername} />
      {mode === 'create' && <Field label="Your name" value={name} onChange={setName} />}
      <Field label="Password" value={password} onChange={setPassword} secure />
      {mode === 'create' && (
        <>
          <Caps style={{ marginTop: 16, color: colors.ink }}>What kind of reader are you?</Caps>
          <Italic style={{ fontSize: 14, marginBottom: 8 }}>The Butler uses this to tune your recommendations.</Italic>
          <View style={{ gap: 8 }}>
            {types.map((t, i) => (
              <Animated.View key={t.key} entering={FadeInDown.delay(i * 60)}>
                <Pressable onPress={() => { tap(); setRt(t.key); }} style={[s.type, rt === t.key && s.typeOn]} accessibilityState={{ selected: rt === t.key }}>
                  <Text style={[s.typeLabel, rt === t.key && { color: colors.gold }]}>{t.label}</Text>
                  <Text style={s.typeBlurb}>{t.blurb}</Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </>
      )}
      {!!error && <ErrorNote message={error} />}
      <Button label={mode === 'create' ? 'Create my account' : 'Sign in'} busy={busy} onPress={go} style={{ marginTop: 18 }} />
      {mode === 'create' && <Italic style={{ fontSize: 13, marginTop: 8 }}>At least 8 characters. Passwords are salted and hashed; we never see them.</Italic>}
    </Animated.View>
  );
}

function ProfileView({ me, types, friends, onChange }: { me: Profile & { stats: Stats }; types: RT[]; friends: any[]; onChange: () => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const add = async () => {
    tap();
    setMsg('');
    try {
      const f = await api.addFriend(code);
      setMsg(`You and ${f.display_name} are now friends.`);
      setCode('');
      onChange();
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  return (
    <Animated.View entering={FadeIn}>
      <Text style={s.h1}>{me.display_name}</Text>
      <Caps style={{ color: colors.gold }}>{me.reader_type_label || 'Reader'}</Caps>
      <Text style={s.stats}>{`${me.stats.books} volumes · ${Math.round(me.stats.hours_read)} hours · ${me.stats.missing_from_collections} to find`}</Text>
      <View style={s.codeBox}>
        <Caps>Your friend code</Caps>
        <Text style={s.code}>{me.friend_code}</Text>
        <Italic style={{ fontSize: 13 }}>Share it so friends can see your bookcase.</Italic>
      </View>
      <Caps style={{ marginTop: 18, color: colors.ink }}>Reader type</Caps>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {types.map((t) => (
          <Chip key={t.key} label={t.label.replace('The ', '')} active={me.reader_type === t.key} onPress={async () => { await api.patchMe({ reader_type: t.key }); onChange(); }} />
        ))}
      </View>
      <Ornament />
      <Caps style={{ color: colors.ink }}>Add a friend</Caps>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" placeholder="FRIEND CODE" placeholderTextColor={colors.sepiaSoft} style={[s.input, { flex: 1 }]} accessibilityLabel="Friend code" />
        <Button label="Add" onPress={add} style={{ minHeight: 40 }} />
      </View>
      {!!msg && <Italic style={{ fontSize: 14, marginTop: 6 }}>{msg}</Italic>}
      <FriendsList friends={friends} />
      <Button label="Sign out" kind="outline" style={{ marginTop: 26 }} onPress={async () => { await setToken(null); onChange(); }} />
    </Animated.View>
  );
}

function FriendsList({ friends }: { friends: any[] }) {
  const router = useRouter();
  if (!friends.length) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Caps style={{ color: colors.ink }}>Friends' bookcases</Caps>
      {friends.map((f, i) => (
        <Animated.View key={f.id} entering={FadeInDown.delay(i * 70)}>
          <Pressable onPress={() => { tap(); router.push(`/friend/${f.id}`); }} style={s.friend}>
            <View style={s.avatar}>
              <Text style={{ fontFamily: fonts.script, fontSize: 24, color: colors.gold }}>{f.display_name[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.friendName}>{f.display_name}</Text>
              <Italic style={{ fontSize: 13 }}>{`${f.reader_type_label || 'Reader'} · ${f.books} books${f.reading_now ? ` · reading ${f.reading_now}` : ''}`}</Italic>
            </View>
            <Caps style={{ color: colors.gold }}>Visit →</Caps>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

function Field({ label, value, onChange, secure }: { label: string; value: string; onChange: (v: string) => void; secure?: boolean }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Caps style={{ fontSize: 9 }}>{label}</Caps>
      <TextInput value={value} onChangeText={onChange} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} style={s.input} accessibilityLabel={label} />
    </View>
  );
}

const s = StyleSheet.create({
  h1: { fontFamily: fonts.display, fontSize: 32, color: colors.ink, marginTop: 14 },
  stats: { fontFamily: fonts.bodyItalic, fontSize: 15, color: colors.inkSoft, marginTop: 6 },
  input: { borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 8, fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  type: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 12 },
  typeOn: { borderColor: colors.gold, backgroundColor: 'rgba(242,181,58,0.08)' },
  typeLabel: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  typeBlurb: { fontFamily: fonts.bodyItalic, fontSize: 13.5, color: colors.inkSoft },
  codeBox: { marginTop: 18, borderWidth: 1, borderColor: 'rgba(242,181,58,0.5)', padding: 16, alignItems: 'center' },
  code: { fontFamily: fonts.display, fontSize: 38, letterSpacing: 8, color: colors.gold, marginVertical: 4 },
  friend: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  friendName: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
});
