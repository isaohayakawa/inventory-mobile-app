import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

/** Short message with optional actions (e.g. "Undo"); hides itself after a few seconds. */
export function Toast({ message, actions, onHide }: { message: string; actions: ToastAction[]; onHide: () => void }) {
  const insets = useSafeAreaInsets();
  const hideRef = useRef(onHide);
  useEffect(() => {
    hideRef.current = onHide;
  }, [onHide]);
  useEffect(() => {
    // Stay a little longer when there's something to tap.
    const t = setTimeout(() => hideRef.current(), actions.length > 0 ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [actions.length]);
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 96 }]} pointerEvents="box-none">
      <View style={styles.toast} accessibilityLiveRegion="polite">
        <Text style={styles.text}>{message}</Text>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            onPress={() => {
              a.onPress();
              onHide();
            }}
            accessibilityRole="button"
            hitSlop={10}
          >
            <Text style={styles.action}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 480,
  },
  text: { color: '#FFFFFF', fontSize: 14, flexShrink: 1 },
  action: { color: '#AEB7FF', fontSize: 14, fontWeight: '700' },
});
