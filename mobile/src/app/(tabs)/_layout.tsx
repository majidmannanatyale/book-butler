import React from 'react';
import { Tabs } from 'expo-router';

import TabBar from '@/components/TabBar';

export const unstable_settings = { anchor: 'index' };

export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} backBehavior="initialRoute" screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="finder" options={{ title: 'Finder' }} />
      <Tabs.Screen name="add" options={{ title: 'Add' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
