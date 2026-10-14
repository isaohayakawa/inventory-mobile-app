import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/state/AppContext';
import { Button, Card, Field, Input, Row, Screen, SectionLabel, Segmented, ToggleRow } from '@/components/ui';
import { SelectField } from '@/components/pickers';
import { type } from '@/theme';
import { activeLocations } from '@/services/snapshot';
import { addPackage, archiveItem, setLocationThreshold, updateItem } from '@/services/inventory';
import { getUnitSystem, sizeUnits } from '@/services/settings';
import { formatQty, formatUnits, plural, unitsPerPackage } from '@/domain/quantity';

const num = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isNaN(n) || n < 0 ? null : n;
};
const str = (n: number | null | undefined) => (n == null ? '' : formatQty(n).replace('½', '.5').replace('¼', '.25').replace('¾', '.75'));

export default function ItemSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, ctx, mutate, showToast } = useApp();
  const summary = snapshot.items.find((s) => s.item.id === id);
  const item = summary?.item;
  const locs = activeLocations(snapshot);
  const unitSystem = getUnitSystem(ctx);

  const [name, setName] = useState(item?.name ?? '');
  const [baseUnit, setBaseUnit] = useState(item?.baseUnit ?? '');
  const [minTotal, setMinTotal] = useState(str(item?.minTotal));
  const [sizeAmount, setSizeAmount] = useState(str(item?.sizeAmount));
  const [sizeUnit, setSizeUnit] = useState(item?.sizeUnit ?? sizeUnits(unitSystem)[0]);
  const [thresholds, setThresholds] = useState<Record<string, { min: string; target: string }>>(() =>
    Object.fromEntries(
      locs.map((l) => {
        const s = snapshot.settings.find((x) => x.itemId === id && x.locationId === l.id);
        return [l.id, { min: str(s?.minQty), target: str(s?.targetQty) }];
      }),
    ),
  );
  const [pkgName, setPkgName] = useState('');
  const [pkgQty, setPkgQty] = useState('');
  const [pkgContains, setPkgContains] = useState<string>('base');

  if (!item || !summary) {
    return (
      <Screen edges={[]}>
        <Text style={type.meta}>Item not found.</Text>
      </Screen>
    );
  }
  const pkgs = [...snapshot.packages.values()].filter((p) => p.itemId === item.id);

  const save = () => {
    const r = mutate((c) => {
      if (!name.trim()) throw new Error('Name is required');
      updateItem(c, item.id, {
        name: name.trim(),
        baseUnit: baseUnit.trim() || item.baseUnit,
        minTotal: num(minTotal),
        sizeAmount: num(sizeAmount),
        sizeUnit: num(sizeAmount) != null ? sizeUnit : null,
      });
      for (const l of locs) {
        const t = thresholds[l.id];
        setLocationThreshold(c, { itemId: item.id, locationId: l.id, minQty: num(t.min), targetQty: num(t.target) });
      }
      return true;
    });
    if (r) {
      showToast('Saved');
      router.back();
    }
  };

  return (
    <Screen edges={[]}>
      <Field label="Name">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="Counted in" hint="The base unit every quantity is stored in.">
        <Input value={baseUnit} onChangeText={setBaseUnit} autoCapitalize="none" />
      </Field>
      <Field label="Track opened ones">
        <Segmented
          value={item.tracking}
          onChange={(v) => mutate((c) => updateItem(c, item.id, { tracking: v }))}
          options={[
            { value: 'count', label: 'By count' },
            { value: 'level', label: 'By level' },
          ]}
        />
      </Field>
      <Field label="Size (optional)">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Input style={{ flex: 1 }} value={sizeAmount} onChangeText={setSizeAmount} keyboardType="decimal-pad" placeholder="Amount" />
          <View style={{ flex: 1 }}>
            <SelectField label="Size unit" value={sizeUnit} onChange={setSizeUnit} options={sizeUnits(unitSystem).map((u) => ({ value: u, label: u }))} />
          </View>
        </View>
      </Field>

      <SectionLabel>Low-stock alerts</SectionLabel>
      <Field label={`Household total (${plural(baseUnit || item.baseUnit, 2)})`} hint="Alert says “buy more”. Leave empty for none.">
        <Input value={minTotal} onChangeText={setMinTotal} keyboardType="decimal-pad" placeholder="e.g. 12" />
      </Field>
      <Text style={type.small}>Per location: alert at or below “Min”. “Keep” is how many you like to have there, so alerts can say how many to move.</Text>
      <Card>
        {locs.map((l, i) => (
          <Row key={l.id} first={i === 0}>
            <Text style={[type.body, { flex: 1 }]}>{l.name}</Text>
            <Input
              style={{ width: 70, minHeight: 40, textAlign: 'center' }}
              value={thresholds[l.id]?.min ?? ''}
              onChangeText={(t) => setThresholds((s) => ({ ...s, [l.id]: { ...s[l.id], min: t } }))}
              placeholder="Min"
              keyboardType="decimal-pad"
              accessibilityLabel={`${l.name} minimum`}
            />
            <Input
              style={{ width: 70, minHeight: 40, textAlign: 'center' }}
              value={thresholds[l.id]?.target ?? ''}
              onChangeText={(t) => setThresholds((s) => ({ ...s, [l.id]: { ...s[l.id], target: t } }))}
              placeholder="Keep"
              keyboardType="decimal-pad"
              accessibilityLabel={`${l.name} keep level`}
            />
          </Row>
        ))}
      </Card>

      <Button label="Save" variant="primary" onPress={save} />

      <SectionLabel>Packages</SectionLabel>
      <Card>
        {pkgs.length === 0 ? (
          <Row first>
            <Text style={type.meta}>Bought one {item.baseUnit} at a time so far.</Text>
          </Row>
        ) : (
          pkgs.map((p, i) => (
            <Row key={p.id} first={i === 0}>
              <Text style={[type.body, { flex: 1 }]}>{p.name}</Text>
              <Text style={type.small}>
                {p.containsPackageId ? `${formatQty(p.containsQty)} × ${snapshot.packages.get(p.containsPackageId)?.name} · ` : ''}
                {formatUnits(unitsPerPackage(p.id, snapshot.packages), item.baseUnit)}
              </Text>
            </Row>
          ))
        )}
      </Card>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Input style={{ flex: 1.3 }} value={pkgName} onChangeText={setPkgName} placeholder="New package, e.g. Case" />
        <Input style={{ flex: 0.7 }} value={pkgQty} onChangeText={setPkgQty} placeholder="Qty" keyboardType="number-pad" />
      </View>
      <SelectField
        label="Each contains"
        value={pkgContains}
        onChange={setPkgContains}
        options={[{ value: 'base', label: `${plural(item.baseUnit, 2)}` }, ...pkgs.map((p) => ({ value: p.id, label: p.name }))]}
      />
      <Button
        label="Add package"
        onPress={() => {
          const q = num(pkgQty);
          const r = mutate((c) => {
            if (!pkgName.trim() || !q) throw new Error('Give the package a name and how many it contains.');
            return addPackage(c, { itemId: item.id, name: pkgName, containsQty: q, containsPackageId: pkgContains === 'base' ? null : pkgContains });
          });
          if (r) {
            setPkgName('');
            setPkgQty('');
          }
        }}
      />

      <SectionLabel>When it runs out</SectionLabel>
      <Card>
        <ToggleRow
          first
          label="Always keep this item"
          sub="Stays in your inventory at 0 without asking."
          value={item.alwaysKeep}
          onChange={(v) => mutate((c) => updateItem(c, item.id, { alwaysKeep: v }))}
        />
      </Card>
      <Button
        label="Archive item"
        variant="danger"
        onPress={() =>
          Alert.alert(`Archive ${item.name}?`, summary.total > 0 ? 'Its remaining stock will be hidden. History is kept and you can restore it.' : 'History is kept and you can restore it later.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Archive',
              style: 'destructive',
              onPress: () => {
                mutate((c) => archiveItem(c, item.id));
                router.dismissTo('/inventory');
              },
            },
          ])
        }
      />
    </Screen>
  );
}
