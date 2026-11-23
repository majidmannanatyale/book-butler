// Runs in the background when Android asks the widget to draw itself.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { ReadingWidget, WidgetData } from './ReadingWidget';

async function load(): Promise<WidgetData> {
  // The app saves its last good snapshot; the widget refreshes it when the server is reachable.
  const cachedRaw = await AsyncStorage.getItem('widgetSnapshot');
  const cached: WidgetData | null = cachedRaw ? JSON.parse(cachedRaw) : null;
  try {
    const base = await AsyncStorage.getItem('apiBaseResolved');
    const token = await AsyncStorage.getItem('authToken');
    if (!base) throw new Error('no server yet');
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const [st, books] = await Promise.all([
      fetch(`${base}/api/stats`, { headers }).then((r) => r.json()),
      fetch(`${base}/api/books?status=owned`, { headers }).then((r) => r.json()),
    ]);
    const r = (books as any[]).find((b) => b.reading);
    const data: WidgetData = {
      name: 'The Book Butler',
      reading: r ? { title: r.title, author: r.author, progress: r.progress || 0 } : null,
      books: st.books,
      hours: Math.round(st.hours_read),
      toFind: st.missing_from_collections,
    };
    await AsyncStorage.setItem('widgetSnapshot', JSON.stringify(data));
    return data;
  } catch {
    return cached || { name: 'The Book Butler', reading: null, books: 0, hours: 0, toFind: 0, offline: true };
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const data = await load();
      props.renderWidget(<ReadingWidget data={data} />);
      break;
    }
    default:
      break;
  }
}
