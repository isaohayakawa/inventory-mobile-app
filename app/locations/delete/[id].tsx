import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/state/AppContext';
import { Button, Card, Field, Row, Screen, SectionLabel, Segmented } from '@/components/ui';
import { LocationSelect, SelectField } from '@/components/pickers';
import { colors, type } from '@/theme';
import { activeLocations, locationName } from '@/services/snapshot';
import { deleteLocation, lotsInLocation, type LocationDeletePlan } from '@/services/locations';
import { resolveZero, type RemoveReason } from '@/services/inventory';
import { describeLot } from '@/domain/quantity';

type RowChoice = { kind: 'move'; to: string | null } | { kind: 'remove'; reason: RemoveReason };
type ZeroChoice = 'keep' | 'list' | 'archive';

const REMOVE = '__remove__';
const DEFAULT = '__default__';

/** Moving summary: every item here is moved or removed before the location is archived. */
export default function DeleteLocationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ctx, snapshot, mutate, showToast } = useApp();
  const others = activeLocations(snapshot).filter((l) => l.id !== id);
  const rows = useMemo(() => lotsInLocation(ctx, id), [ctx, id]);
  const thresholdCount = snapshot.settings.filter((s) => s.locationId === id).length;

  const [dest, setDest] = useState<string | null>(others[0]?.id ?? null);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [zeroChoices, setZeroChoices] = useState<Record<string, ZeroChoice>>({});
  const [thresholds, setThresholds] = useState<'move' | 'drop'>('move');

  const choiceFor = (lotId: string): RowChoice => choices[lotId] ?? { kind: 'move', to: null };
  const destOf = (c: RowChoice) => (c.kind === 'move' ? c.to ?? dest : null);

  // An item reaches 0 when all of its stock is here and every lot of it is removed.
  const zeroItems = useMemo(() => {
    const out = new Map<string, string>();
    const byItem = new Map<string, typeof rows>();
    for (const r of rows) byItem.set(r.item.id, [...(byItem.get(r.item.id) ?? []), r]);
    for (const [itemId, rs] of byItem) {
      const summary = snapshot.items.find((s) => s.item.id === itemId);
      const elsewhere = summary ? summary.total - rs.reduce((s, r) => s + r.lot.qtyBase, 0) : 0;
      if (elsewhere <= 0 && rs.every((r) => choiceFor(r.lot.id).kind === 'remove') && !rs[0].item.alwaysKeep && !rs[0].item.archivedAt) {
        out.set(itemId, rs[rs.length - 1].lot.id);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, choices, snapshot]);

  const name = locationName(snapshot, id);

  const confirm = () => {
    if (!dest && rows.some((r) => choiceFor(r.lot.id).kind === 'move')) return;
    const plan: LocationDeletePlan = {
      lotActions: rows.map((r) => {
        const c = choiceFor(r.lot.id);
        return c.kind === 'move'
          ? { lotId: r.lot.id, action: 'move' as const, toLocationId: destOf(c)! }
          : { lotId: r.lot.id, action: 'remove' as const, reason: c.reason };
      }),
      thresholds: thresholds === 'move' && dest ? { action: 'move', toLocationId: dest } : { action: 'drop' },
    };
    const r = mutate((c) => {
      const res = deleteLocation(c, id, plan);
      for (const itemId of res.zeroed) resolveZero(c, { itemId, choice: zeroChoices[itemId] ?? 'keep' });
      return { done: true };
    });
    if (r) {
      showToast(`Deleted ${name}`);
      router.back();
    }
  };

  const destOptions = [
    { value: DEFAULT, label: dest ? `→ ${locationName(snapshot, dest)}` : 'Choose…' },
    ...others.map((l) => ({ value: l.id, label: `→ ${l.name}` })),
    { value: REMOVE, label: 'Remove' },
  ];

  return (
    <Screen edges={[]}>
      <Text style={type.meta}>
        {name} has {rows.length} {rows.length === 1 ? 'item' : 'items'}. Move them or remove them, then {name} is deleted. Its name stays in your history.
      </Text>

      <Field label="Move everything to">
        <LocationSelect value={dest} locations={others} onChange={setDest} />
      </Field>

      <SectionLabel>Moving summary</SectionLabel>
      <Card>
        {rows.map((r, i) => {
          const c = choiceFor(r.lot.id);
          const zero = zeroItems.get(r.item.id) === r.lot.id;
          return (
            <Row key={r.lot.id} first={i === 0} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={type.bodyStrong}>{r.item.name}</Text>
                  <Text style={type.small}>
                    {describeLot(r.lot, r.item, snapshot.packages)} ({r.lot.state})
                  </Text>
                </View>
                <View style={{ width: 150 }}>
                  <SelectField
                    label={`${r.item.name}: destination`}
                    value={c.kind === 'remove' ? REMOVE : c.to ?? DEFAULT}
                    options={destOptions}
                    onChange={(v) =>
                      setChoices((s) => ({
                        ...s,
                        [r.lot.id]: v === REMOVE ? { kind: 'remove', reason: 'unknown' } : { kind: 'move', to: v === DEFAULT ? null : v },
                      }))
                    }
                  />
                </View>
              </View>
              {c.kind === 'remove' ? (
                <Segmented
                  value={c.reason}
                  onChange={(reason) => setChoices((s) => ({ ...s, [r.lot.id]: { kind: 'remove', reason } }))}
                  options={[
                    { value: 'used_up', label: 'Used up' },
                    { value: 'thrown_out', label: 'Tossed' },
                    { value: 'unknown', label: "Don't know" },
                  ]}
                />
              ) : null}
              {zero ? (
                <View style={{ gap: 6 }}>
                  <Text style={[type.small, { color: colors.low }]}>{r.item.name} will be at 0 everywhere. Then:</Text>
                  <Segmented
                    value={zeroChoices[r.item.id] ?? 'keep'}
                    onChange={(v) => setZeroChoices((s) => ({ ...s, [r.item.id]: v }))}
                    options={[
                      { value: 'keep', label: 'Keep' },
                      { value: 'list', label: 'Shopping list' },
                      { value: 'archive', label: 'Archive' },
                    ]}
                  />
                </View>
              ) : null}
            </Row>
          );
        })}
      </Card>

      {thresholdCount > 0 ? (
        <Field label={`${name}'s low-stock alerts (${thresholdCount})`}>
          <Segmented
            value={thresholds}
            onChange={setThresholds}
            options={[
              { value: 'move', label: dest ? `Move to ${locationName(snapshot, dest)}` : 'Move' },
              { value: 'drop', label: 'Drop them' },
            ]}
          />
        </Field>
      ) : null}

      <Button label={`Move items and delete ${name}`} variant="danger" onPress={confirm} disabled={!dest && rows.some((r) => choiceFor(r.lot.id).kind === 'move')} />
    </Screen>
  );
}
