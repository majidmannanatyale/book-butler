// What your friends thought of a book: their stars, a line of their review, or "did not finish".
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { QuarterStars } from '@/components/RatingReview';
import { Caps, tap } from '@/components/ui';
import { api, Verdict } from '@/api';
import { colors, fonts } from '@/theme';

export function stars(n?: number | null) {
  if (!n) return '';
  const whole = Math.floor(n);
  const q = Math.round((n - whole) * 4);
  return `★${whole}${['', '¼', '½', '¾'][q]}`;
}

/** Small inline badge: "Ada ★4¾" (or "Ada DNF"); best-rated friend first. */
export function VerdictBadge({ verdicts, onCream = false }: { verdicts?: Verdict[]; onCream?: boolean }) {
  if (!verdicts?.length) return null;
  const v = [...verdicts].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
  const more = verdicts.length > 1 ? ` +${verdicts.length - 1}` : '';
  return (
    <Text numberOfLines={1} style={[s.badge, onCream && { color: '#8A5A00' }]}>
      {`${v.friend} ${v.dnf ? 'DNF' : stars(v.rating)}${more}`}
    </Text>
  );
}

export default function FriendVerdicts({ title, author, dark = false }: { title: string; author: string; dark?: boolean }) {
  const router = useRouter();
  const [list, setList] = useState<Verdict[]>([]);
  useEffect(() => {
    api
      .friendVerdicts([{ title, author }])
      .then((r) => setList(r.verdicts[0] || []))
      .catch(() => {});
  }, [title, author]);
  if (!list.length) return null;
  return (
    <View style={{ marginTop: 16 }}>
      <Caps style={{ color: dark ? colors.wallMuted : colors.sepia }}>What your friends thought</Caps>
      {list.map((v, i) => (
        <Animated.View key={`${v.friend_id}${i}`} entering={FadeInDown.delay(i * 80)}>
          <Pressable onPress={() => { tap(); router.push(`/friend/${v.friend_id}`); }} style={s.row} accessibilityRole="button">
            <View style={s.avatar}>
              <Text style={{ fontFamily: fonts.script, fontSize: 20, color: colors.gold }}>{v.friend[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.name}>{v.friend}</Text>
                {v.dnf ? <Caps style={{ fontSize: 8, color: '#D98B72' }}>did not finish</Caps> : v.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <QuarterStars value={v.rating} size={13} />
                    <Text style={s.num}>{stars(v.rating).slice(1)}</Text>
                  </View>
                ) : null}
              </View>
              {!!v.review && (
                <Text style={s.review} numberOfLines={3}>
                  {`“${v.review}”`}
                </Text>
              )}
            </View>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  review: { fontFamily: fonts.bodyItalic, fontSize: 14.5, color: colors.inkSoft, marginTop: 2 },
  num: { fontFamily: fonts.body, fontSize: 12, color: colors.gold },
  badge: { fontFamily: fonts.body, fontSize: 10.5, color: colors.gold, marginTop: 3 },
});
