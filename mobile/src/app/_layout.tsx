import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_500Medium_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  EBGaramond_400Regular,
  EBGaramond_500Medium,
  EBGaramond_400Regular_Italic,
} from '@expo-google-fonts/eb-garamond';
import { PinyonScript_400Regular } from '@expo-google-fonts/pinyon-script';

import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_400Regular_Italic,
    CormorantGaramond_500Medium_Italic,
    EBGaramond_400Regular,
    EBGaramond_500Medium,
    EBGaramond_400Regular_Italic,
    PinyonScript_400Regular,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.paper }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.paper }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="book/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: colors.wall } }} />
          <Stack.Screen name="librarian" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="account" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="friend/[id]" options={{ animation: 'fade' }} />
          <Stack.Screen name="pick" options={{ presentation: 'modal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: colors.wall } }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
