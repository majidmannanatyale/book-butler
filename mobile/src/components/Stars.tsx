import React from 'react';
import { Text } from 'react-native';

import { colors } from '@/theme';

/** 1–5 confidence stars, drawn as ★ / ☆ in gilt. */
export default function Stars({ n, size = 13, onCream = false }: { n: number; size?: number; dark?: boolean; onCream?: boolean }) {
  const on = onCream ? '#C98A0E' : colors.gold;
  const off = onCream ? 'rgba(201,138,14,0.3)' : 'rgba(242,181,58,0.3)';
  return (
    <Text accessibilityLabel={`${n} of 5 stars`} style={{ fontSize: size, letterSpacing: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={{ color: i <= n ? on : off }}>
          {i <= n ? '★' : '☆'}
        </Text>
      ))}
    </Text>
  );
}
