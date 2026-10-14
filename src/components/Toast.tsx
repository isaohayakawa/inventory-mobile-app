import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme';

/** Short message with an optional action (e.g. "Undo"); hides itself after 5 seconds. */
export function Toast({
  message,
  actionLabel,
  onAction,
  onHide,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onHide: () => void;
}) {
  const insets = useSafeAreaInsets();
  const hideRef = useRef(onHide);
  useEffect(() => {
    hideRef.current = onHide;
  }, [onHide]);
  useEffect(() => {
    const t = setTimeout(() => hideRef.current(), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 96 }]} pointerEvents="box-none">
      <View style={styles.toast} accessibilityLiveRegion="polite">
        <Text style={styles.text}>{message}</Text>
        {actionLabel && onAction ? (
          <Pressable
            onPress={() => {
              onAction();
              onHide();
            }}
            accessibilityRole="button"
            hitSlop={10}
          >
            <Text style={styles.action}>{actionLabel}</Text>
          </Pressable>
        ) : null}
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
