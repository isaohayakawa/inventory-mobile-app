import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/state/AppContext';
import { Button, Card, Field, Input, Row, Screen, Segmented, Stepper } from '@/components/ui';
import { DateInput, LocationSelect, SelectField } from '@/components/pickers';
import { colors, type } from '@/theme';
import { suggest, nameOf, similarItems, type Suggestion } from '@/services/search';
import { createItem, addStock, restoreItem, type NewPackageInput } from '@/services/inventory';
import { getUnitSystem, sizeUnits } from '@/services/settings';
import { activeLocations } from '@/services/snapshot';
import { formatUnits, LEVELS, plural } from '@/domain/quantity';
import type { CommonItem } from '@/data/commonItems';
import type { Item } from '@/db/schema';

const SINGLE = '__single__';
const NEW_PKG = '__new__';

/** Remembers the last location used for new items during this session. */
let lastLocationId: string | null = null;

export default function AddItemScreen() {
  const { snapshot, ctx, mutate, showToast } = useApp();
  const params = useLocalSearchParams<{ name?: string }>();
  const locs = activeLocations(snapshot);
  const allItems = useMemo<Item[]>(
    () => [...snapshot.items.map((s) => s.item), ...snapshot.archivedItems],
    [snapshot],
  );

  const [name, setName] = useState(params.name ?? '');
  const [picked, setPicked] = useState<CommonItem | 'new' | null>(params.name ? 'new' : null);
  const [focused, setFocused] = useState(!params.name);
  const [baseUnit, setBaseUnit] = useState('unit');
  const [category, setCategory] = useState<string | null>(null);
  const [tracking, setTracking] = useState<'count' | 'level'>('count');
  const [pkgChoice, setPkgChoice] = useState<string>(SINGLE);
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgQty, setNewPkgQty] = useState('6');
  const [count, setCount] = useState(1);
  const [state, setState] = useState<'sealed' | 'opened'>('sealed');
  const [level, setLevel] = useState(1);
  const [locationId, setLocationId] = useState<string | null>(
    lastLocationId && locs.some((l) => l.id === lastLocationId) ? lastLocationId : locs.find((l) => l.name === 'Pantry')?.id ?? locs[0]?.id ?? null,
  );
  const [showExpiry, setShowExpiry] = useState(false);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [sizeAmount, setSizeAmount] = useState('');
  const [unitSystem] = useState(() => getUnitSystem(ctx));
  const [sizeUnit, setSizeUnit] = useState(sizeUnits(unitSystem)[0]);
  const [minTotal, setMinTotal] = useState('');

  const suggestions = useMemo(() => (focused ? suggest({ query: name, items: allItems, limit: 6 }) : []), [focused, name, allItems]);

  const commonPkgs = picked && picked !== 'new' ? picked.packages ?? [] : [];
  const pkgOptions = [
    { value: SINGLE, label: `Single ${baseUnit}` },
    ...commonPkgs.map((p, i) => ({ value: `c${i}`, label: p.name, sub: `${p.containsQty} ${plural(baseUnit, p.containsQty)}` })),
    { value: NEW_PKG, label: 'New package…', sub: 'e.g. 12-pack' },
  ];
  const unitsPer =
    pkgChoice === SINGLE ? 1 : pkgChoice === NEW_PKG ? Math.max(1, Number(newPkgQty) || 1) : commonPkgs[Number(pkgChoice.slice(1))]?.containsQty ?? 1;

  const choose = (s: Suggestion) => {
    setFocused(false);
    if (s.kind === 'own') {
      router.replace(`/restock/${s.item.id}`);
      return;
    }
    if (s.kind === 'archived') {
      Alert.alert(`Restore ${s.item.name}?`, 'It was archived. Restoring brings back its history and settings.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () => {
            mutate((c) => restoreItem(c, s.item.id));
            router.replace(`/restock/${s.item.id}`);
          },
        },
      ]);
      return;
    }
    if (s.kind === 'common') {
      const c = s.common;
      setName(c.name);
      setPicked(c);
      setBaseUnit(c.baseUnit);
      setCategory(c.category);
      setTracking(c.level ? 'level' : 'count');
      setPkgChoice(SINGLE);
      setShowExpiry(!!c.perishable);
      return;
    }
    setName(s.name);
    setPicked('new');
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return Alert.alert('Add a name first');
    if (!locationId) return Alert.alert('Choose a location');
    const similar = similarItems(trimmed, allItems);
    if (similar.length > 0) {
      const match = similar[0];
      Alert.alert(`Did you mean ${match.name}?`, 'You already have an item with a very similar name.', [
        {
          text: `Use ${match.name}`,
          onPress: () => {
            if (match.archivedAt) mutate((c) => restoreItem(c, match.id));
            router.replace(`/restock/${match.id}`);
          },
        },
        { text: 'Create new', onPress: create },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    create();
  };

  const create = () => {
    const packages: NewPackageInput[] = commonPkgs.map((p, i) => ({ key: `c${i}`, name: p.name, containsQty: p.containsQty }));
    if (pkgChoice === NEW_PKG) {
      if (!newPkgName.trim()) return Alert.alert('Name the package', 'For example "12-pack" or "Case".');
      packages.push({ key: NEW_PKG, name: newPkgName.trim(), containsQty: unitsPer });
    }
    const amount = sizeAmount.trim() ? Number(sizeAmount) : null;
    const res = mutate((c) => {
      const { itemId, packageIds } = createItem(c, {
        name: name.trim(),
        baseUnit: baseUnit.trim() || 'unit',
        category,
        tracking,
        minTotal: minTotal.trim() ? Number(minTotal) : null,
        sizeAmount: amount != null && !Number.isNaN(amount) ? amount : null,
        sizeUnit,
        packages,
      });
      const result = addStock(c, {
        itemId,
        packageId: pkgChoice === SINGLE ? null : packageIds[pkgChoice] ?? null,
        count,
        state,
        level: tracking === 'level' && state === 'opened' ? level : null,
        locationId: locationId!,
        expiresOn: showExpiry ? expiresOn : null,
      });
      return { ...result, itemId };
    });
    if (!res) return;
    lastLocationId = locationId;
    showToast(`Added ${name.trim()}`);
    router.back();
  };

  const showForm = picked != null;

  return (
    <Screen edges={[]}>
      <Field label="What is it?">
        <Input
          value={name}
          focused={focused}
          autoFocus={!params.name}
          placeholder="Paper towels, coffee, AA batteries…"
          onFocus={() => setFocused(true)}
          onChangeText={(t) => {
            setName(t);
            setFocused(true);
          }}
          returnKeyType="next"
          onSubmitEditing={() => {
            if (suggestions[0]) choose(suggestions[0]);
          }}
          accessibilityLabel="Item name"
        />
      </Field>

      {focused && suggestions.length > 0 ? (
        <Card>
          {suggestions.map((s, i) => (
            <Row key={`${s.kind}-${nameOf(s)}-${i}`} first={i === 0} onPress={() => choose(s)} accessibilityLabel={nameOf(s)}>
              <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
                {s.kind === 'new' ? `Add “${s.name}” as new item` : nameOf(s)}
              </Text>
              <Text style={type.small}>
                {s.kind === 'own'
                  ? `In your home · ${formatUnits(snapshot.items.find((x) => x.item.id === s.item.id)?.total ?? 0, s.item.baseUnit)}`
                  : s.kind === 'archived'
                    ? 'Archived'
                    : s.kind === 'common'
                      ? 'Common item'
                      : '›'}
              </Text>
            </Row>
          ))}
        </Card>
      ) : null}

      {showForm && !focused ? (
        <>
          {picked !== 'new' ? (
            <View style={{ backgroundColor: colors.subtle, borderRadius: 12, padding: 10 }}>
              <Text style={type.small}>Filled in from common items: counted in {plural(baseUnit, 2)}. Change anything below.</Text>
            </View>
          ) : null}

          <Field label="Counted in" hint="The smallest unit you use one at a time: roll, can, bottle…">
            <Input value={baseUnit} onChangeText={setBaseUnit} autoCapitalize="none" accessibilityLabel="Base unit" />
          </Field>

          <Field label="Quantity" hint={`= ${formatUnits(count * unitsPer, baseUnit)}`}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Stepper value={count} onChange={setCount} label="Quantity" />
              </View>
              <View style={{ flex: 1.3 }}>
                <SelectField label="Package" value={pkgChoice} options={pkgOptions} onChange={setPkgChoice} />
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
                <Field label={`${plural(baseUnit, 2)} inside`}>
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

          {tracking === 'level' && state === 'opened' && unitsPer * count <= 1 ? (
            <Field label="How full?">
              <Segmented
                value={String(level)}
                onChange={(v) => setLevel(Number(v))}
                options={LEVELS.filter((l) => l.value > 0).map((l) => ({ value: String(l.value), label: l.label }))}
              />
            </Field>
          ) : null}

          <Field label="Location">
            <LocationSelect value={locationId} locations={locs} onChange={setLocationId} />
          </Field>

          {showExpiry ? (
            <Field label="Expires (optional)">
              <DateInput value={expiresOn} onChange={setExpiresOn} />
            </Field>
          ) : (
            <Pressable onPress={() => setShowExpiry(true)} accessibilityRole="button" style={{ flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44 }}>
              <Ionicons name="calendar-outline" size={18} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '600' }}>Add expiry date</Text>
            </Pressable>
          )}

          <Field label="Size (optional)">
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Input style={{ flex: 1 }} value={sizeAmount} onChangeText={setSizeAmount} placeholder="Amount" keyboardType="decimal-pad" />
              <View style={{ flex: 1 }}>
                <SelectField
                  label="Size unit"
                  value={sizeUnit}
                  onChange={setSizeUnit}
                  options={sizeUnits(unitSystem).map((u) => ({ value: u, label: u }))}
                />
              </View>
            </View>
          </Field>

          <Field label="Low-stock alert (optional)" hint={`Notify when the total is at or below this many ${plural(baseUnit, 2)}.`}>
            <Input value={minTotal} onChangeText={setMinTotal} placeholder="e.g. 2" keyboardType="decimal-pad" />
          </Field>

          <Field label="Track opened ones">
            <Segmented
              value={tracking}
              onChange={setTracking}
              options={[
                { value: 'count', label: 'By count' },
                { value: 'level', label: 'By level (Full/½/Low)' },
              ]}
            />
          </Field>

          <Button label="Add to inventory" variant="primary" onPress={submit} />
        </>
      ) : null}

      {!showForm && !focused ? (
        <Button label="Continue" variant="primary" onPress={() => choose({ kind: 'new', name, score: 0 })} disabled={!name.trim()} />
      ) : null}
    </Screen>
  );
}
