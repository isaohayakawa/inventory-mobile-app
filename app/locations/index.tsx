import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '@/state/AppContext';
import { Button, Card, IconButton, Input, Row, Screen } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { type } from '@/theme';
import { activeLocations } from '@/services/snapshot';
import { createLocation, deleteLocation, lotsInLocation, renameLocation, reorderLocation } from '@/services/locations';

export default function LocationsScreen() {
  const { snapshot, mutate, ctx } = useApp();
  const locs = activeLocations(snapshot);
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);

  const itemsIn = (id: string) => snapshot.items.filter((s) => s.lots.some((l) => l.locationId === id)).length;
  const hasStock = (id: string) => lotsInLocation(ctx, id).length > 0;

  const onDelete = (id: string, name: string) => {
    if (hasStock(id)) {
      router.push(`/locations/delete/${id}`);
      return;
    }
    Alert.alert(`Delete ${name}?`, 'It has no items. Its name stays in your history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => mutate((c) => deleteLocation(c, id, { lotActions: [], thresholds: { action: 'drop' } })),
      },
    ]);
  };

  const save = () => {
    if (!editing) return;
    const r = mutate((c) => {
      if (editing.id) renameLocation(c, editing.id, editing.name);
      else createLocation(c, editing.name);
      return true;
    });
    if (r) setEditing(null);
  };

  return (
    <Screen edges={[]}>
      <Text style={type.meta}>The order here is the order of location chips in Inventory.</Text>
      <Card>
        {locs.map((l, i) => (
          <Row key={l.id} first={i === 0}>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{l.name}</Text>
              <Text style={type.small}>
                {itemsIn(l.id)} {itemsIn(l.id) === 1 ? 'item' : 'items'}
              </Text>
            </View>
            <IconButton icon="arrow-up" label={`Move ${l.name} up`} onPress={() => mutate((c) => reorderLocation(c, l.id, -1))} />
            <IconButton icon="arrow-down" label={`Move ${l.name} down`} onPress={() => mutate((c) => reorderLocation(c, l.id, 1))} />
            <IconButton icon="pencil" label={`Rename ${l.name}`} onPress={() => setEditing({ id: l.id, name: l.name })} />
            <IconButton icon="trash-outline" label={`Delete ${l.name}`} onPress={() => onDelete(l.id, l.name)} />
          </Row>
        ))}
      </Card>
      <Button label="Add location" variant="primary" icon="add" onPress={() => setEditing({ id: null, name: '' })} />

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Rename location' : 'New location'}>
        <Input
          value={editing?.name ?? ''}
          onChangeText={(t) => setEditing((e) => (e ? { ...e, name: t } : e))}
          placeholder="e.g. Hall closet"
          autoFocus
          onSubmitEditing={save}
        />
        <Button label="Save" variant="primary" onPress={save} disabled={!editing?.name.trim()} />
      </Sheet>
    </Screen>
  );
}
