import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '@/state/AppContext';
import { Card, Empty, IconButton, Pill, Row, Screen, SearchBox, SectionLabel, Title, Button } from '@/components/ui';
import { ItemRow } from '@/components/ItemRow';
import { Sheet } from '@/components/Sheet';
import { colors, type } from '@/theme';
import { formatUnits, plural } from '@/domain/quantity';
import { locationName, recentlyUsedItemIds, stockElsewhere, suggestedMoveQty, type ItemSummary } from '@/services/snapshot';
import { matchesSearch } from '@/services/search';
import { addToShoppingList } from '@/services/shopping';
import { consumeOne, setLotExpiry } from '@/services/inventory';
import { executeMoves, planQuickMove, resolveExpired } from '@/services/quick';
import { daysUntil, formatShortDate } from '@/lib/time';
import type { StockLot } from '@/db/schema';

interface Attention {
  key: string;
  summary: ItemSummary;
  title: string;
  meta: string;
  tone: 'low' | 'expired' | 'soon';
  action?: { label: string; solid?: boolean; onPress: () => void };
  onPress: () => void;
}

export default function HomeScreen() {
  const { snapshot, ctx, mutate, showToast, version } = useApp();
  const [query, setQuery] = useState('');
  const [expiredLot, setExpiredLot] = useState<{ lot: StockLot; summary: ItemSummary } | null>(null);

  const attention = useMemo<Attention[]>(() => {
    const out: Attention[] = [];
    for (const s of snapshot.items) {
      const open = () => router.push(`/item/${s.item.id}`);
      for (const loc of s.lowLocations) {
        const elsewhere = stockElsewhere(s, loc.locationId);
        const where = locationName(snapshot, loc.locationId);
        if (elsewhere.qty > 0 && elsewhere.bestLocationId) {
          const need = suggestedMoveQty(loc, elsewhere.bestQty) || 1;
          const plan = planQuickMove(s, elsewhere.bestLocationId, need, snapshot.packages);
          out.push({
            key: `loc-${s.item.id}-${loc.locationId}`,
            summary: s,
            title: `${s.item.name} · ${where}`,
            meta: `${formatUnits(loc.qty, s.item.baseUnit)} left · ${formatUnits(elsewhere.bestQty, s.item.baseUnit)} in ${locationName(snapshot, elsewhere.bestLocationId)}`,
            tone: 'low',
            action: plan.moved <= 0 ? undefined : {
              label: `Move ${plan.moved}`,
              onPress: () => {
                const r = mutate((c) => executeMoves(c, plan.moves, loc.locationId));
                if (r) showToast(`Moved ${formatUnits(plan.moved, s.item.baseUnit)} to ${where}`);
              },
            },
            onPress: open,
          });
        } else if (!s.lowTotal) {
          out.push({
            key: `loc-${s.item.id}-${loc.locationId}`,
            summary: s,
            title: `${s.item.name} · ${where}`,
            meta: `${formatUnits(loc.qty, s.item.baseUnit)} left · none anywhere else`,
            tone: 'low',
            action: s.onShoppingList ? undefined : listAction(s),
            onPress: open,
          });
        }
      }
      if (s.lowTotal || s.isOut) {
        out.push({
          key: `total-${s.item.id}`,
          summary: s,
          title: s.item.name,
          meta: s.isOut ? 'Out of stock' : `${formatUnits(s.total, s.item.baseUnit)} left, all locations`,
          tone: 'low',
          action: s.onShoppingList ? { label: 'Bought it', onPress: () => router.push(`/restock/${s.item.id}`) } : listAction(s),
          onPress: open,
        });
      }
      for (const lot of s.expiringLots) {
        const expired = daysUntil(lot.expiresOn!) < 0;
        out.push({
          key: `exp-${lot.id}`,
          summary: s,
          title: s.item.name,
          meta: `${expired ? 'Expired' : 'Expires'} ${formatShortDate(lot.expiresOn!)} · ${locationName(snapshot, lot.locationId)}`,
          tone: expired ? 'expired' : 'soon',
          action: expired ? { label: 'Resolve', onPress: () => setExpiredLot({ lot, summary: s }) } : undefined,
          onPress: expired ? () => setExpiredLot({ lot, summary: s }) : open,
        });
      }
    }
    const rank = { expired: 0, low: 1, soon: 2 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);

    function listAction(s: ItemSummary) {
      return {
        label: '+ List',
        solid: true,
        onPress: () => {
          mutate((c) => addToShoppingList(c, { name: s.item.name, itemId: s.item.id }));
          showToast(`Added ${s.item.name} to your list`);
        },
      };
    }
  }, [snapshot, mutate, showToast]);

  const recent = useMemo(() => {
    const ids = recentlyUsedItemIds(ctx, 5);
    return ids.map((id) => snapshot.items.find((s) => s.item.id === id)).filter((s): s is ItemSummary => !!s);
    // version changes whenever data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, snapshot, version]);

  const results = useMemo(
    () => (query.trim() ? snapshot.items.filter((s) => matchesSearch(query, s.item.name)) : []),
    [query, snapshot],
  );

  const quickUse = (s: ItemSummary) => {
    if (s.item.tracking === 'level') {
      router.push(`/item/${s.item.id}`);
      return;
    }
    mutate((c) => consumeOne(c, { itemId: s.item.id }));
  };

  const locSummary = (s: ItemSummary) =>
    s.byLocation
      .filter((b) => b.qty > 0)
      .map((b) => `${locationName(snapshot, b.locationId)} ${formatUnits(b.qty, s.item.baseUnit).split(' ')[0]}`)
      .join(' · ') || 'None in stock';

  return (
    <Screen>
      <Title>My Home</Title>
      <SearchBox value={query} onChangeText={setQuery} placeholder="Do we have…?" />

      {query.trim() ? (
        <Card>
          {results.length === 0 ? (
            <Row first>
              <View style={{ flex: 1 }}>
                <Text style={type.bodyStrong}>Not in your inventory</Text>
                <Text style={type.small}>No item matches “{query.trim()}”.</Text>
              </View>
              <Pill label="Add it" solid onPress={() => router.push({ pathname: '/add', params: { name: query.trim() } })} />
            </Row>
          ) : (
            results.map((s, i) => (
              <ItemRow key={s.item.id} first={i === 0} summary={s} meta={locSummary(s)} onPress={() => router.push(`/item/${s.item.id}`)} />
            ))
          )}
        </Card>
      ) : (
        <>
          <SectionLabel>{`Needs attention${attention.length ? ` · ${attention.length}` : ''}`}</SectionLabel>
          {attention.length === 0 ? (
            <Card>
              <Row first>
                <Text style={type.meta}>Nothing is low or expiring. Nice.</Text>
              </Row>
            </Card>
          ) : (
            <Card>
              {attention.slice(0, 8).map((a, i) => (
                <Row key={a.key} first={i === 0} onPress={a.onPress} accessibilityLabel={`${a.title}. ${a.meta}`}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: a.tone === 'soon' ? '#D98E04' : colors.low,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={type.bodyStrong} numberOfLines={1}>
                      {a.title}
                    </Text>
                    <Text style={[type.small, a.tone === 'expired' && { color: colors.low }]} numberOfLines={2}>
                      {a.meta}
                    </Text>
                  </View>
                  {a.action ? <Pill label={a.action.label} solid={a.action.solid} onPress={a.action.onPress} /> : null}
                </Row>
              ))}
            </Card>
          )}

          <SectionLabel>Recently used</SectionLabel>
          {recent.length === 0 ? (
            snapshot.items.length === 0 ? (
              <Card>
                <Empty
                  title="Start with what's in front of you"
                  body="Add things as you buy, unpack or remember them. No need to inventory the whole house."
                  action={<Button label="Add your first item" variant="primary" onPress={() => router.push('/add')} />}
                />
              </Card>
            ) : (
              <Card>
                <Row first>
                  <Text style={type.meta}>Tap − on an item when you use one.</Text>
                </Row>
              </Card>
            )
          ) : (
            <Card>
              {recent.map((s, i) => (
                <ItemRow
                  key={s.item.id}
                  first={i === 0}
                  summary={s}
                  meta={locSummary(s)}
                  onPress={() => router.push(`/item/${s.item.id}`)}
                  right={
                    s.total > 0 ? (
                      <IconButton icon="remove" label={`Used 1 ${s.item.name}`} onPress={() => quickUse(s)} />
                    ) : undefined
                  }
                />
              ))}
            </Card>
          )}
        </>
      )}

      <Sheet visible={!!expiredLot} onClose={() => setExpiredLot(null)} title={expiredLot ? `${expiredLot.summary.item.name} expired` : ''}>
        {expiredLot ? (
          <>
            <Text style={type.meta}>
              {formatUnits(expiredLot.lot.qtyBase, expiredLot.summary.item.baseUnit)} in {locationName(snapshot, expiredLot.lot.locationId)}, expired{' '}
              {formatShortDate(expiredLot.lot.expiresOn!)}.
            </Text>
            <Button
              label="Used it"
              variant="primary"
              onPress={() => {
                mutate((c) => resolveExpired(c, expiredLot.lot.id, 'used'));
                setExpiredLot(null);
              }}
            />
            <Button
              label="Throw out"
              variant="danger"
              onPress={() => {
                mutate((c) => resolveExpired(c, expiredLot.lot.id, 'thrown_out'));
                setExpiredLot(null);
              }}
            />
            <Button
              label="Still good"
              onPress={() => {
                mutate((c) => setLotExpiry(c, { lotId: expiredLot.lot.id, expiresOn: null }));
                showToast(`Kept ${expiredLot.summary.item.name}; expiry date cleared`);
                setExpiredLot(null);
              }}
            />
            <Text style={type.small}>
              {`“Throw out” is recorded as waste, not as normal use, so it won't skew future ${plural('estimate', 2)}.`}
            </Text>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
