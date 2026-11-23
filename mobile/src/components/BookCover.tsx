// A cover image, or — when there is none — a typeset cloth binding in the
// spirit of the clothbound classics, so the library never shows broken images.
import React, { useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { colors, fonts } from '@/theme';

const CLOTH = ['#5C2624', '#1F344A', '#284030', '#6B5A3C', '#3C2846', '#1E3C3C', '#7A3B2E', '#2E2E36'];

function clothFor(title: string) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CLOTH[h % CLOTH.length];
}

export default function BookCover({
  title,
  author,
  uri,
  width,
  style,
}: {
  title: string;
  author?: string;
  uri?: string | null;
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const height = width * 1.5;
  if (uri && !failed) {
    return (
      <View style={[{ width, height }, s.shadow, style]}>
        <Image
          source={{ uri }}
          style={{ width, height, borderRadius: 1.5 }}
          contentFit="cover"
          transition={300}
          onError={() => setFailed(true)}
          accessibilityLabel={`Cover of ${title}`}
        />
        <View style={s.spineShade} />
      </View>
    );
  }
  const bg = clothFor(title);
  const f = Math.max(9, width / 8.5);
  return (
    <View style={[{ width, height, backgroundColor: bg }, s.cloth, s.shadow, style]} accessibilityLabel={`Cover of ${title}`}>
      <View style={[s.frame, { margin: width * 0.07 }]}>
        <Text numberOfLines={4} style={{ fontFamily: fonts.display, color: '#EADFC6', fontSize: f * 1.25, textAlign: 'center', lineHeight: f * 1.45 }}>
          {title}
        </Text>
        <Text style={{ color: '#C9A86A', fontSize: f * 0.7, marginVertical: f * 0.4 }}>◆</Text>
        {!!author && (
          <Text numberOfLines={2} style={{ fontFamily: fonts.bodyItalic, color: '#D8CBAE', fontSize: f * 0.85, textAlign: 'center' }}>
            {author}
          </Text>
        )}
      </View>
      <View style={s.spineShade} />
    </View>
  );
}

const s = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 5 },
    elevation: 6,
    borderRadius: 1.5,
  },
  cloth: { justifyContent: 'center', borderRadius: 1.5, overflow: 'hidden' },
  frame: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(201,168,106,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  spineShade: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
});
