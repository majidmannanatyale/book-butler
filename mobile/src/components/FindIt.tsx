// Where to get a book you don't own: friends who have it, reputable stores
// and libraries (search links — no invented prices), and bookshops near you.
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Caps, Italic, tap } from '@/components/ui';
import { api } from '@/api';
import { colors, fonts } from '@/theme';

let Location: any = null;
try {
  Location = require('expo-location');
} catch {
  Location = null;
}

type Shop = { name: string; kind: string; km: number; address: string; maps: string };

export default function FindIt({ title, author, collectible, collectibleWhy, priceSeen }: { title: string; author: string; collectible?: boolean; collectibleWhy?: string; priceSeen?: string }) {
  const [links, setLinks] = useState<{ name: string; kind: string; url: string }[]>([]);
  const [friends, setFriends] = useState<string[]>([]);
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'denied' | 'error'>('idle');

  useEffect(() => {
    api
      .where(title, author)
      .then((r) => {
        setLinks(r.links);
        setFriends(r.friends);
      })
      .catch(() => {});
  }, [title, author]);

  const near = async () => {
    tap();
    if (!Location) return setState('error');
    setState('busy');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setState('denied');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 });
      const r = await api.nearby(pos.coords.latitude, pos.coords.longitude);
      setShops(r.shops);
      setState('idle');
    } catch {
      setState('error');
    }
  };

  return (
    <View style={{ marginTop: 24 }}>
      {collectible && (
        <View style={s.valuable}>
          <Caps color={colors.gold}>◆ Possibly valuable</Caps>
          <Italic color={colors.wallText} style={{ fontSize: 15, marginTop: 4 }}>
            {collectibleWhy || 'Looks like a collectible edition.'}
            {priceSeen ? `  The sticker reads ${priceSeen} — compare it with AbeBooks before you leave.` : ''}
          </Italic>
        </View>
      )}
      {friends.length > 0 && (
        <View style={s.friend}>
          <Caps color={colors.owned}>{`${friends.join(' & ')} ${friends.length > 1 ? 'own' : 'owns'} this`}</Caps>
          <Italic color={colors.wallText} style={{ fontSize: 15 }}>Borrow it before you buy it?</Italic>
        </View>
      )}
      <Caps color={colors.wallMuted} style={{ marginTop: 14 }}>Find a copy</Caps>
      {links.map((l, i) => (
        <Animated.View key={l.name} entering={FadeInDown.delay(i * 50)}>
          <Pressable onPress={() => Linking.openURL(l.url)} style={s.row} accessibilityRole="link">
            <Text style={s.name}>{l.name}</Text>
            <Text style={s.kind}>{l.kind}</Text>
            <Caps color={colors.gold} style={{ fontSize: 9 }}>Search →</Caps>
          </Pressable>
        </Animated.View>
      ))}
      <Italic color={colors.wallMuted} style={{ fontSize: 12, marginTop: 6 }}>
        Live prices need retailer API keys, so we link straight to each store's search instead of guessing.
      </Italic>

      <Caps color={colors.wallMuted} style={{ marginTop: 18 }}>Near you</Caps>
      {shops === null ? (
        <Pressable onPress={near} disabled={state === 'busy' || !Location} style={[s.nearBtn, !Location && { opacity: 0.5 }]}>
          <Caps color={colors.gold}>{state === 'busy' ? 'Looking around…' : state === 'denied' ? 'Location not allowed' : 'Bookshops & libraries near me'}</Caps>
        </Pressable>
      ) : shops.length ? (
        shops.slice(0, 6).map((sh, i) => (
          <Animated.View key={sh.name} entering={FadeInDown.delay(i * 60)}>
            <Pressable onPress={() => Linking.openURL(sh.maps)} style={s.row}>
              <Text style={s.name}>{sh.name}</Text>
              <Text style={s.kind}>{`${sh.kind} · ${sh.km} km`}</Text>
              <Caps color={colors.gold} style={{ fontSize: 9 }}>Map →</Caps>
            </Pressable>
          </Animated.View>
        ))
      ) : (
        <Italic color={colors.wallMuted} style={{ fontSize: 14 }}>No bookshops found nearby.</Italic>
      )}
      <Italic color={colors.wallMuted} style={{ fontSize: 11.5, marginTop: 6, opacity: 0.8 }}>
        Your location is rounded to about 1 km and only used to search OpenStreetMap.
      </Italic>
    </View>
  );
}

const s = StyleSheet.create({
  valuable: { borderWidth: 1, borderColor: colors.gold, padding: 12, backgroundColor: 'rgba(242,181,58,0.08)', marginBottom: 12 },
  friend: { borderLeftWidth: 2, borderColor: colors.owned, paddingLeft: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.wallText, flexShrink: 1 },
  kind: { fontFamily: fonts.bodyItalic, fontSize: 12.5, color: colors.wallMuted, flex: 1 },
  nearBtn: { marginTop: 8, borderWidth: 1, borderColor: colors.gold, paddingVertical: 11, alignItems: 'center' },
});
