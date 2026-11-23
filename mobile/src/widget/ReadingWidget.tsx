// Android home-screen widget: what you're reading + your collection at a glance.
'use no memo';
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

export type WidgetData = {
  name: string;
  reading: { title: string; author: string; progress: number } | null;
  books: number;
  hours: number;
  toFind: number;
  offline?: boolean;
};

const NAVY = '#081325';
const SAGE = '#A9CDBE';
const GOLD = '#F2B53A';
const CREAM = '#EEF2EC';
const SERIF = 'CormorantGaramond_500Medium';
const ITALIC = 'EBGaramond_400Regular_Italic';

export function ReadingWidget({ data }: { data: WidgetData }) {
  const pct = Math.round((data.reading?.progress || 0) * 100);
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: NAVY, borderRadius: 18, padding: 14, flexDirection: 'column', justifyContent: 'space-between' }}
    >
      <TextWidget text="THE BOOK BUTLER" style={{ fontSize: 10, color: GOLD, letterSpacing: 0.2, fontFamily: SERIF }} />
      {data.reading ? (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <TextWidget text="Reading now" style={{ fontSize: 11, color: SAGE, fontFamily: ITALIC }} />
          <TextWidget text={data.reading.title} maxLines={1} truncate="END" style={{ fontSize: 20, color: CREAM, fontFamily: SERIF }} />
          <TextWidget text={data.reading.author} maxLines={1} style={{ fontSize: 12, color: SAGE, fontFamily: ITALIC }} />
          <FlexWidget style={{ height: 3, width: 'match_parent', backgroundColor: '#1E2E48', marginTop: 6, flexDirection: 'row' }}>
            <FlexWidget style={{ height: 3, flex: Math.max(1, pct), backgroundColor: GOLD }} />
            <FlexWidget style={{ height: 3, flex: Math.max(1, 100 - pct) }} />
          </FlexWidget>
        </FlexWidget>
      ) : (
        <TextWidget text={data.offline ? 'Open the app to sync your shelf.' : 'Nothing on the go — pick something lovely.'} style={{ fontSize: 14, color: SAGE, fontFamily: ITALIC }} />
      )}
      <TextWidget
        text={`${data.books} volumes  ·  ${data.hours} hours  ·  ${data.toFind} to find`}
        style={{ fontSize: 11, color: SAGE, fontFamily: ITALIC }}
      />
    </FlexWidget>
  );
}
