// Push fresh data to the home-screen widget whenever the app has it.
import React from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ReadingWidget, WidgetData } from './ReadingWidget';

export async function refreshWidget(data: WidgetData) {
  await AsyncStorage.setItem('widgetSnapshot', JSON.stringify(data)).catch(() => {});
  if (Platform.OS !== 'android') return;
  try {
    const { requestWidgetUpdate } = require('react-native-android-widget');
    await requestWidgetUpdate({ widgetName: 'ReadingWidget', renderWidget: () => <ReadingWidget data={data} /> });
  } catch {
    // no widget module in this build, or no widget placed yet
  }
}
