// A friend's bookcase — read-only, in 3D.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Shelf3D from '@/components/Shelf3D';
import { IconBack } from '@/components/Icons';
import { Caps, ErrorNote, Italic } from '@/components/ui';
import { api, Book, getBase, Profile, Stats } from '@/api';
import { colors, fonts } from '@/theme';

export default function FriendShelf() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<{ user: Profile; stats: Stats; books: Book[] } | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getBase().then(setBase);
    api
      .friendShelf(Number(id))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 18 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ paddingVertical: 6 }} accessibilityLabel="Back">
          <IconBack color={colors.ink} />
        </Pressable>
        {!!error && <ErrorNote message={error} />}
        {data && (
          <>
            <Caps>{`${data.user.reader_type_label || 'Reader'} · ${data.stats.books} volumes`}</Caps>
            <Text style={s.h1}>{`${data.user.display_name}'s bookcase`}</Text>
            {!!data.user.bio && <Italic style={{ fontSize: 15 }}>{data.user.bio}</Italic>}
          </>
        )}
      </View>
      {data && base ? (
        data.books.length ? (
          <Shelf3D books={data.books} base={base} onOpen={() => {}} readOnly />
        ) : (
          <Italic style={{ textAlign: 'center', padding: 40 }}>Nothing on these shelves yet.</Italic>
        )
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  h1: { fontFamily: fonts.display, fontSize: 30, color: colors.ink, marginTop: 2 },
});
