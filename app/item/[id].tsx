import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/state/AppContext';
import { Button, Card, IconButton, Row, Screen, SectionLabel, Tag, Title } from '@/components/ui';
import { LotSheet } from '@/components/LotSheet';
import { colors, type } from '@/theme';
import { describeLot, formatQty, formatUnits, plural } from '@/domain/quantity';
import { expiryStatusFor, itemHistory, locationName } from '@/services/snapshot';
import { consumeOne } from '@/services/inventory';
import { formatShortDate, relativeDay } from '@/lib/time';
import type { InventoryEvent, StockLot } from '@/db/schema';

export default function ItemDetailScreen() {
  // ?moveLot=…&moveCount=… (from "Change" after adding) opens that lot's Move panel.
  const { id, moveLot, moveCount } = useLocalSearchParams<{ id: string; moveLot?: string; moveCount?: string }>();
  const { snapshot, ctx, mutate, version } = useApp();
  const [selected, setSelected] = useState<StockLot | null>(
    () => (moveLot && snapshot.items.find((s) => s.item.id === id)?.lots.find((l) => l.id === moveLot)) || null,
  );
  const [movingCount, setMovingCount] = useState(moveLot ? Number(moveCount) || 1 : undefined);
  const summary = snapshot.items.find((s) => s.item.id === id);
  const history = useMemo(() => (id ? itemHistory(ctx, id, 20) : []), [ctx, id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!summary) {
    const archived = snapshot.archivedItems.find((i) => i.id === id);
    return (
      <Screen edges={[]}>
        <Text style={type.meta}>{archived ? `${archived.name} is archived.` : 'Item not found.'}</Text>
        {archived ? <Button label="Restore with Bought more" variant="primary" onPress={() => router.replace(`/restock/${archived.id}`)} /> : null}
      </Screen>
    );
  }
  const { item } = summary;
  const firstToUse = summary.lots.find((l) => l.qtyBase > 0);

  const lotRow = (lot: StockLot, first: boolean) => {
    const status = expiryStatusFor(lot.expiresOn, snapshot.prefs.expiryWindowDays);
    const expColor = status === 'expired' ? colors.low : status === 'soon' ? '#B26B00' : colors.textSecondary;
    const quickUse = lot.state === 'opened' && item.tracking === 'count';
    return (
      <Row key={lot.id} first={first} onPress={() => setSelected(lot)} accessibilityLabel={`${describeLot(lot, item, snapshot.packages)}, ${lot.state}`}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.body}>{describeLot(lot, item, snapshot.packages)}</Text>
          {lot.expiresOn ? (
            <Text style={[type.small, { color: expColor }]}>
              {status === 'expired' ? 'Expired' : 'Expires'} {formatShortDate(lot.expiresOn)}
              {firstToUse?.id === lot.id && summary.lots.filter((l) => l.expiresOn).length > 1 ? ' · use first' : ''}
            </Text>
          ) : null}
        </View>
        <Tag label={lot.state === 'sealed' ? 'Sealed' : 'Opened'} tone={lot.state === 'sealed' ? 'sealed' : 'opened'} />
        {quickUse ? (
          <IconButton icon="remove" label={`Used 1 from ${locationName(snapshot, lot.locationId)}`} onPress={() => mutate((c) => consumeOne(c, { itemId: item.id, lotId: lot.id }))} />
        ) : null}
      </Row>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => <IconButton icon="settings-outline" label="Item settings" onPress={() => router.push(`/item-settings/${item.id}`)} />,
        }}
      />
      <Title sub={item.category ?? undefined}>{item.name}</Title>

      <Card style={{ paddingVertical: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ fontSize: 44, fontWeight: '700', color: summary.isOut ? colors.out : colors.text }}>{formatQty(summary.total)}</Text>
          <Text style={[type.body, { color: colors.textSecondary }]}>{plural(item.baseUnit, summary.total === 1 ? 1 : 2)} total</Text>
        </View>
        {summary.breakdown.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {summary.breakdown.map((b) => (
              <View key={b} style={{ backgroundColor: colors.subtle, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ fontSize: 13, color: colors.text }}>{b}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={type.small}>
          {item.minTotal != null ? `Alert when total ≤ ${formatQty(item.minTotal)} ${plural(item.baseUnit, 2)}` : 'No total alert set'}
          {item.sizeAmount != null ? ` · ${formatQty(item.sizeAmount)} ${item.sizeUnit ?? ''} each` : ''}
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {summary.total > 0 && item.tracking === 'count' ? (
          <Button style={{ flex: 1 }} label="Used 1" icon="remove" onPress={() => mutate((c) => consumeOne(c, { itemId: item.id }))} />
        ) : null}
        <Button style={{ flex: 1 }} label="Bought more" variant="primary" icon="bag-add-outline" onPress={() => router.push(`/restock/${item.id}`)} />
      </View>

      <SectionLabel>By location</SectionLabel>
      {summary.byLocation.length === 0 ? (
        <Card>
          <Row first>
            <Text style={type.meta}>None in stock. Tap Bought more when you restock.</Text>
          </Row>
        </Card>
      ) : (
        summary.byLocation.map((b) => (
          <View key={b.locationId} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={type.bodyStrong}>
                {locationName(snapshot, b.locationId)}
                {b.low ? <Text style={{ color: colors.low, fontSize: 13 }}> ● low</Text> : null}
              </Text>
              <Text style={type.small}>
                {formatUnits(b.qty, item.baseUnit)}
                {b.minQty != null ? ` · alert ≤ ${formatQty(b.minQty)}` : ''}
              </Text>
            </View>
            {b.lots.length > 0 ? <Card>{b.lots.map((lot, i) => lotRow(lot, i === 0))}</Card> : null}
          </View>
        ))
      )}
      <Text style={type.small}>Tap a lot to open, move, fix the count, set expiry or remove it.</Text>

      <SectionLabel>History</SectionLabel>
      <Card>
        {history.length === 0 ? (
          <Row first>
            <Text style={type.meta}>No history yet.</Text>
          </Row>
        ) : (
          history.map((ev, i) => (
            <Row key={ev.id} first={i === 0}>
              <Text style={[type.meta, { flex: 1, color: colors.text }]}>{describeEvent(ev, item.baseUnit, (lid) => locationName(snapshot, lid))}</Text>
              <Text style={type.small}>{relativeDay(ev.occurredAt)}</Text>
            </Row>
          ))
        )}
      </Card>

      <LotSheet
        lot={selected}
        item={item}
        moveCount={movingCount}
        onClose={() => {
          setSelected(null);
          setMovingCount(undefined);
        }}
      />
    </Screen>
  );
}

const REASONS: Record<string, string> = {
  used_up: 'used up',
  thrown_out: 'thrown out',
  expired: 'expired',
  unknown: "don't know",
  undo: 'undo',
  count: 'count fixed',
};

function describeEvent(ev: InventoryEvent, unit: string, loc: (id: string | null) => string): string {
  const meta = ev.meta ? (JSON.parse(ev.meta) as Record<string, unknown>) : {};
  const n = (q: number) => formatUnits(Math.abs(q), unit);
  switch (ev.type) {
    case 'added':
      return `Added ${n(ev.deltaBase)} · ${loc(ev.toLocationId)}`;
    case 'used':
      return `Used ${n(ev.deltaBase)} · ${loc(ev.fromLocationId)}`;
    case 'opened':
      return `Opened ${String(meta.packageName ?? 'pack')} · ${loc(ev.toLocationId ?? ev.fromLocationId)}`;
    case 'level_changed':
      return `Level changed to ${formatQty(Number(meta.level ?? 0))}`;
    case 'emptied':
      return `Finished one · ${loc(ev.fromLocationId)}`;
    case 'moved':
      return `Moved ${n(Number(meta.qty ?? 0))} · ${loc(ev.fromLocationId)} → ${loc(ev.toLocationId)}`;
    case 'removed':
      return `Removed ${n(ev.deltaBase)} (${REASONS[ev.reason ?? ''] ?? ev.reason}) · ${loc(ev.fromLocationId)}`;
    case 'corrected':
      return `${ev.reason === 'undo' ? 'Undid add' : 'Count fixed'} (${ev.deltaBase > 0 ? '+' : '−'}${n(ev.deltaBase)})`;
    case 'item_archived':
      return 'Archived';
    case 'item_restored':
      return 'Restored';
  }
}
