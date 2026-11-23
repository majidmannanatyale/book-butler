import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { colors, fonts } from '@/theme';

type TP = TextProps & { style?: StyleProp<TextStyle>; color?: string };

export const Display = ({ style, color, ...p }: TP) => (
  <Text {...p} style={[s.display, color ? { color } : null, style]} />
);
export const Italic = ({ style, color, ...p }: TP) => (
  <Text {...p} style={[s.italic, color ? { color } : null, style]} />
);
export const Body = ({ style, color, ...p }: TP) => (
  <Text {...p} style={[s.body, color ? { color } : null, style]} />
);
/** Small-caps label, widely tracked — the "museum placard" voice. */
export const Caps = ({ style, color, children, ...p }: TP) => (
  <Text {...p} style={[s.caps, color ? { color } : null, style]}>
    {typeof children === 'string' ? children.toUpperCase() : children}
  </Text>
);

export function tap() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
}

export function Button({
  label,
  onPress,
  kind = 'solid',
  dark = false,
  cream = false,
  busy = false,
  disabled = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'solid' | 'outline' | 'ghost';
  dark?: boolean;
  cream?: boolean;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  // solid = marigold on navy; on cream cards, navy ink instead
  const fg = cream
    ? kind === 'solid' ? colors.cream : colors.creamInk
    : kind === 'solid' ? colors.paper : colors.ink;
  const bg = kind === 'solid' ? (cream ? colors.creamInk : colors.gold) : 'transparent';
  const border = kind === 'outline' ? (cream ? colors.creamInk : 'rgba(242,181,58,0.7)') : 'transparent';
  void dark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      disabled={disabled || busy}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Caps style={{ color: fg, letterSpacing: 2.2 }}>{label}</Caps>}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  dark = false,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  dark?: boolean;
}) {
  const fg = active ? colors.gold : dark ? colors.wallText : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[
        s.chip,
        { borderColor: active ? colors.gold : colors.line },
        active && { backgroundColor: 'rgba(242,181,58,0.10)' },
      ]}
    >
      <Caps style={{ color: fg, fontSize: 10.5, opacity: active ? 1 : 0.7 }}>{label}</Caps>
    </Pressable>
  );
}

export const Rule = ({ dark = false, style }: { dark?: boolean; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }, style]} />
);

/** Little ornament: ——  ◆  —— */
export const Ornament = ({ dark = false }: { dark?: boolean }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginVertical: 10 }}>
    <Rule dark={dark} style={{ width: 36 }} />
    <Text style={{ color: colors.gold, fontSize: 8 }}>◆</Text>
    <Rule dark={dark} style={{ width: 36 }} />
  </View>
);

export function ErrorNote({ message, dark = false }: { message: string; dark?: boolean }) {
  return (
    <View style={[s.err, dark && { borderColor: 'rgba(194,122,98,0.6)' }]}>
      <Italic style={{ color: dark ? '#E3B4A3' : colors.danger, fontSize: 16 }}>{message}</Italic>
    </View>
  );
}

const s = StyleSheet.create({
  display: { fontFamily: fonts.display, fontSize: 34, color: colors.ink, letterSpacing: 0.2 },
  italic: { fontFamily: fonts.displayItalic, fontSize: 18, color: colors.inkSoft },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.ink, lineHeight: 23 },
  caps: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 2.4, color: colors.sepia },
  btn: {
    minHeight: 46,
    paddingHorizontal: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
  },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderRadius: 2 },
  err: { borderLeftWidth: 2, borderColor: colors.danger, paddingLeft: 12, paddingVertical: 6, marginVertical: 8 },
});
