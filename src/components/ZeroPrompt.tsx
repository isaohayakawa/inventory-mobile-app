import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Item } from '@/db/schema';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { colors, type } from '@/theme';
import { useApp } from '@/state/AppContext';
import { resolveZero } from '@/services/inventory';

/**
 * Shown when an item reaches 0 everywhere. Dismissing means Keep.
 * "Always keep this item" stops the prompt for that item.
 */
export function ZeroPrompt({ item, onDone }: { item: Item; onDone: () => void }) {
  const { mutate } = useApp();
  const [always, setAlways] = useState(false);
  const choose = (choice: 'keep' | 'list' | 'archive') => {
    mutate((ctx) => resolveZero(ctx, { itemId: item.id, choice, alwaysKeep: always && choice !== 'archive' }));
    onDone();
  };
  return (
    <Sheet visible onClose={() => choose('keep')} title={`${item.name} is out`}>
      <Text style={type.meta}>What should happen to it?</Text>
      <View style={{ gap: 10 }}>
        <Button label="Add to shopping list" variant="primary" icon="cart-outline" onPress={() => choose('list')} />
        <Button label="Keep, I'll restock" onPress={() => choose('keep')} />
        <Button label="Archive item" variant="danger" onPress={() => choose('archive')} />
      </View>
      <Pressable
        onPress={() => setAlways((a) => !a)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: always }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
      >
        <Ionicons name={always ? 'checkbox' : 'square-outline'} size={22} color={colors.accent} />
        <Text style={type.body}>Always keep this item</Text>
      </Pressable>
    </Sheet>
  );
}
