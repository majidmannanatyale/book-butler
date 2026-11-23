import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';

import { IconAdd, IconFinder, IconHome, IconLibrary, IconSettings } from './Icons';
import { tap } from './ui';
import { colors, fonts } from '@/theme';

const META: Record<string, { label: string; Icon: any }> = {
  index: { label: 'Home', Icon: IconHome },
  library: { label: 'Library', Icon: IconLibrary },
  finder: { label: 'Finder', Icon: IconFinder },
  add: { label: 'Add', Icon: IconAdd },
  settings: { label: 'Settings', Icon: IconSettings },
};

export default function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const dark = current === 'finder';
  const fg = dark ? colors.wallText : colors.ink;
  return (
    <View
      style={[
        s.bar,
        { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: dark ? colors.wall : colors.paper },
        { borderTopColor: dark ? 'rgba(233,225,207,0.12)' : colors.line },
      ]}
    >
      {state.routes.map((route, i) => {
        const meta = META[route.name];
        if (!meta) return null;
        const focused = state.index === i;
        const onPress = () => {
          tap();
          if (!focused) navigateToTab(route.key);
        };
        if (route.name === 'finder') {
          return (
            <Pressable key={route.key} onPress={onPress} accessibilityRole="button" accessibilityLabel="Book Finder" style={s.centerWrap}>
              <View style={[s.center, { backgroundColor: colors.gold }]}>
                <View style={[s.centerRing, { borderColor: colors.paper }]} />
                <meta.Icon color={colors.paper} size={28} weight={1.5} />
              </View>
              <Text style={[s.label, { color: fg, opacity: focused ? 1 : 0.55 }]}>FINDER</Text>
            </Pressable>
          );
        }
        return (
          <Pressable key={route.key} onPress={onPress} accessibilityRole="button" accessibilityLabel={meta.label} style={s.item}>
            <meta.Icon color={fg} size={23} weight={focused ? 1.5 : 1.1} />
            <Text style={[s.label, { color: fg, opacity: focused ? 1 : 0.5 }]}>{meta.label.toUpperCase()}</Text>
            <View style={[s.dot, { backgroundColor: focused ? colors.gold : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: { alignItems: 'center', minWidth: 58, gap: 3, paddingTop: 4 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 9, letterSpacing: 1.8 },
  dot: { width: 3, height: 3, borderRadius: 2, marginTop: 1 },
  centerWrap: { alignItems: 'center', marginTop: -26, gap: 4 },
  center: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  centerRing: { position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, borderRadius: 27, borderWidth: 1 },
});
