import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { useApp } from '@/state/AppContext';
import { Button, Field, Input, Screen, Segmented, Stepper, Title } from '@/components/ui';
import { DateInput, LocationSelect, SelectField } from '@/components/pickers';
import { type } from '@/theme';
import { addStock, addPackage, undoAdd } from '@/services/inventory';
import { activeLocations } from '@/services/snapshot';
import { formatUnits, plural, unitsPerPackage } from '@/domain/quantity';
import { inventoryEvents, stockLots } from '@/db/schema';

const SINGLE = '__single__';
const NEW_PKG = '__new__';

/** "Bought more": restock an existing item in one tap, everything prefilled from last time. */
export default function RestockScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { snapshot, ctx, mutate, showToast } = useApp();
  const summary = snapshot.items.find((s) => s.item.id === id);
  const locs = activeLocations(snapshot);

  const defaults = useMemo(() => {
    if (!summary) return null;
    const lastAdd = ctx.db
      .select()
      .from(inventoryEvents)
      .where(and(eq(inventoryEvents.itemId, summary.item.id), eq(inventoryEvents.type, 'added')))
      .orderBy(desc(inventoryEvents.occurredAt))
      .get();
    const lastLot = lastAdd?.lotId ? ctx.db.select().from(stockLots).where(eq(stockLots.id, lastAdd.lotId)).get() : undefined;
    // Where sealed stock is usually kept: the location holding the most sealed units.
    const sealedByLoc = new Map<string, number>();
    for (const l of summary.lots) if (l.state === 'sealed') sealedByLoc.set(l.locationId, (sealedByLoc.get(l.locationId) ?? 0) + l.qtyBase);
    const usual = [...sealedByLoc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? lastAdd?.toLocationId ?? summary.byLocation[0]?.locationId;
    const hadDates = !!ctx.db
      .select({ id: stockLots.id })
      .from(stockLots)
      .where(and(eq(stockLots.itemId, summary.item.id), isNotNull(stockLots.expiresOn)))
      .get();
    return {
      packageId: lastLot?.state === 'sealed' ? lastLot.packageId : null,
      locationId: usual && locs.some((l) => l.id === usual) ? usual : locs[0]?.id ?? null,
      hadDates,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.item.id]);

  const [count, setCount] = useState(1);
  const [pkgChoice, setPkgChoice] = useState<string>(defaults?.packageId ?? SINGLE);
  const [state, setState] = useState<'sealed' | 'opened'>('sealed');
  const [locationId, setLocationId] = useState<string | null>(defaults?.locationId ?? null);
  const [showExpiry, setShowExpiry] = useState(defaults?.hadDates ?? false);
  // Always blank, so an old date is never copied by mistake.
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgQty, setNewPkgQty] = useState('6');

  if (!summary) {
    return (
      <Screen edges={[]}>
        <Text style={type.meta}>This item isn’t in your inventory anymore.</Text>
      </Screen>
    );
  }
  const item = summary.item;
  const pkgs = [...snapshot.packages.values()].filter((p) => p.itemId === item.id);
  const options = [
    { value: SINGLE, label: `Single ${item.baseUnit}` },
    ...pkgs.map((p) => ({ value: p.id, label: p.name, sub: formatUnits(unitsPerPackage(p.id, snapshot.packages), item.baseUnit) })),
    { value: NEW_PKG, label: 'New package…' },
  ];
  const unitsPer =
    pkgChoice === SINGLE ? 1 : pkgChoice === NEW_PKG ? Math.max(1, Number(newPkgQty) || 1) : unitsPerPackage(pkgChoice, snapshot.packages);
  const total = count * unitsPer;

  const save = () => {
    if (!locationId) return;
    const r = mutate((c) => {
      let packageId: string | null = pkgChoice === SINGLE ? null : pkgChoice;
      if (pkgChoice === NEW_PKG) {
        if (!newPkgName.trim()) throw new Error('Name the new package, e.g. "12-pack".');
        packageId = addPackage(c, { itemId: item.id, name: newPkgName, containsQty: unitsPer });
      }
      return addStock(c, { itemId: item.id, packageId, count, state, locationId, expiresOn: showExpiry ? expiresOn : null });
    });
    if (!r) return;
    showToast(`Added ${formatUnits(total, item.baseUnit)} of ${item.name}`, {
      label: 'Undo',
      onPress: () => mutate((c) => undoAdd(c, r.eventIds)),
    });
    router.back();
  };

  return (
    <Screen edges={[]}>
      <Title sub="Bought more">{item.name}</Title>
      <Text style={type.meta}>Now: {formatUnits(summary.total, item.baseUnit)}</Text>

      <Field label="Quantity" hint={`= ${formatUnits(total, item.baseUnit)}`}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Stepper value={count} onChange={setCount} label="Quantity" />
          </View>
          <View style={{ flex: 1.3 }}>
            <SelectField label="Package" value={pkgChoice} options={options} onChange={setPkgChoice} />
          </View>
        </View>
      </Field>

      {pkgChoice === NEW_PKG ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.4 }}>
            <Field label="Package name">
              <Input value={newPkgName} onChangeText={setNewPkgName} placeholder="12-pack" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={`${plural(item.baseUnit, 2)} inside`}>
              <Input value={newPkgQty} onChangeText={setNewPkgQty} keyboardType="number-pad" />
            </Field>
          </View>
        </View>
      ) : null}

      <Field label="State">
        <Segmented
          value={state}
          onChange={setState}
          options={[
            { value: 'sealed', label: 'Sealed' },
            { value: 'opened', label: 'Opened' },
          ]}
        />
      </Field>

      <Field label="Location">
        <LocationSelect value={locationId} locations={locs} onChange={setLocationId} />
      </Field>

      {showExpiry ? (
        <Field label="Expires">
          <DateInput value={expiresOn} onChange={setExpiresOn} />
        </Field>
      ) : (
        <Button variant="ghost" icon="calendar-outline" label="Add expiry date" onPress={() => setShowExpiry(true)} />
      )}

      <Button label={`Add ${formatUnits(total, item.baseUnit)}`} variant="primary" onPress={save} />
    </Screen>
  );
}
