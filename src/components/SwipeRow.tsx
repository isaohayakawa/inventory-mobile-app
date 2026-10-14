import React, { useMemo, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

const ACTION_W = 112;

/**
 * Swipe a row left to reveal an action ("Bought more"). Built on PanResponder so it
 * needs no extra native modules. Releasing past the action width triggers it.
 * The action is also reachable without swiping via `accessibilityActions`.
 */
export function SwipeRow({
  children,
  actionLabel,
  onAction,
}: {
  children: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  const [x] = useState(() => new Animated.Value(0));
  const pan = useMemo(() => {
    const reset = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => x.setValue(Math.max(-ACTION_W * 1.4, Math.min(0, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -ACTION_W * 0.8) onAction();
        reset();
      },
      onPanResponderTerminate: reset,
    });
  }, [x, onAction]);

  return (
    <View
      accessibilityActions={[{ name: 'activate', label: actionLabel }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') onAction();
      }}
    >
      <View style={styles.action} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="bag-add-outline" size={18} color={colors.onAccent} />
        <Text style={styles.actionText}>{actionLabel}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: colors.card }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    position: 'absolute',
    right: -14,
    top: 0,
    bottom: 0,
    width: ACTION_W + 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  actionText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
});
