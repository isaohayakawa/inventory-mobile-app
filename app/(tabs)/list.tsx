import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/state/AppContext';
import { Button, Card, IconButton, Input, Pill, Row, Screen, SectionLabel, Title } from '@/components/ui';
import { colors, type } from '@/theme';
import { formatUnits } from '@/domain/quantity';
import {
  addToShoppingList,
  clearCheckedShopping,
  listShopping,
  removeShoppingItem,
  setShoppingChecked,
  shoppingSuggestions,
} from '@/services/shopping';

export default function ShoppingListScreen() {
  const { ctx, snapshot, mutate, version } = useApp();
  const [text, setText] = useState('');
  const list = useMemo(() => listShopping(ctx), [ctx, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggestions = shoppingSuggestions(snapshot);

  const add = () => {
    const name = text.trim();
    if (!name) return;
    const match = snapshot.items.find((s) => s.item.name.toLowerCase() === name.toLowerCase());
    mutate((c) => addToShoppingList(c, { name: match?.item.name ?? name, itemId: match?.item.id ?? null }));
    setText('');
  };

  return (
    <Screen>
      <Title>Shopping list</Title>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Input style={{ flex: 1 }} value={text} onChangeText={setText} placeholder="Add something to buy" onSubmitEditing={add} returnKeyType="done" />
        <Button label="Add" variant="primary" onPress={add} disabled={!text.trim()} />
      </View>

      <SectionLabel>{`To buy${list.open.length ? ` · ${list.open.length}` : ''}`}</SectionLabel>
      <Card>
        {list.open.length === 0 ? (
          <Row first>
            <Text style={type.meta}>Your list is empty.</Text>
          </Row>
        ) : (
          list.open.map((l, i) => {
            const s = l.itemId ? snapshot.items.find((x) => x.item.id === l.itemId) : undefined;
            return (
              <Row key={l.id} first={i === 0}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: false }}
                  accessibilityLabel={`Bought ${l.name}`}
                  hitSlop={10}
                  onPress={() => (l.itemId ? router.push(`/restock/${l.itemId}`) : mutate((c) => setShoppingChecked(c, l.id, true)))}
                >
                  <Ionicons name="square-outline" size={24} color={colors.accent} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{l.name}</Text>
                  {s ? <Text style={type.small}>{s.isOut ? 'None left' : `${formatUnits(s.total, s.item.baseUnit)} at home`}</Text> : null}
                </View>
                <IconButton icon="close" color={colors.textSecondary} label={`Remove ${l.name}`} onPress={() => mutate((c) => removeShoppingItem(c, l.id))} />
              </Row>
            );
          })
        )}
      </Card>
      {list.open.some((l) => l.itemId) ? (
        <Text style={type.small}>Checking off an item from your inventory opens Bought more, so stock stays up to date.</Text>
      ) : null}

      {suggestions.length > 0 ? (
        <>
          <SectionLabel>You may want to buy</SectionLabel>
          <Card>
            {suggestions.map((s, i) => (
              <Row key={s.item.id} first={i === 0}>
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{s.item.name}</Text>
                  <Text style={[type.small, { color: colors.low }]}>{s.isOut ? 'Out of stock' : `${formatUnits(s.total, s.item.baseUnit)} left`}</Text>
                </View>
                <Pill label="+ List" solid onPress={() => mutate((c) => addToShoppingList(c, { name: s.item.name, itemId: s.item.id }))} />
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      {list.done.length > 0 ? (
        <>
          <SectionLabel right={<Button small variant="ghost" label="Clear" onPress={() => mutate((c) => clearCheckedShopping(c))} />}>
            Bought
          </SectionLabel>
          <Card>
            {list.done.map((l, i) => (
              <Row key={l.id} first={i === 0}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: true }}
                  accessibilityLabel={`Put ${l.name} back on the list`}
                  hitSlop={10}
                  onPress={() => mutate((c) => setShoppingChecked(c, l.id, false))}
                >
                  <Ionicons name="checkbox" size={24} color={colors.textTertiary} />
                </Pressable>
                <Text style={[type.body, { flex: 1, color: colors.textTertiary, textDecorationLine: 'line-through' }]}>{l.name}</Text>
              </Row>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
