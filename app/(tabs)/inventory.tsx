import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/state/AppContext';
import { Button, Card, Chip, Empty, Row, Screen, SearchBox, Segmented, Title } from '@/components/ui';
import { ItemRow } from '@/components/ItemRow';
import { SwipeRow } from '@/components/SwipeRow';
import { LocationChips, type LocationChipInfo } from '@/components/LocationChips';
import { colors, type } from '@/theme';
import { formatQty, formatUnits, levelLabel, tracksLotState } from '@/domain/quantity';
import { activeLocations, expiryStatusFor, locationName, stockElsewhere, type ItemSummary } from '@/services/snapshot';
import { matchesSearch } from '@/services/search';
import { addToShoppingList, needsBuying } from '@/services/shopping';
import { formatShortDate } from '@/lib/time';

type View_ = 'all' | 'location';
type Filter = 'all' | 'low' | 'opened' | 'out' | 'expiring';
type Sort = 'az' | 'recent';

export default function InventoryScreen() {
  const { snapshot, mutate, showToast } = useApp();
  const params = useLocalSearchParams<{ location?: string; filter?: Filter }>();
  const [view, setView] = useState<View_>(params.location ? 'location' : 'all');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(params.filter ?? 'all');
  const [sort, setSort] = useState<Sort>('az');
  const [selectedLoc, setSelectedLoc] = useState<string | null>(params.location ?? null);

  // Arriving with ?location=… (e.g. from an alert) selects that location's chip.
  const [seenParams, setSeenParams] = useState({ location: params.location, filter: params.filter });
  if (seenParams.location !== params.location || seenParams.filter !== params.filter) {
    setSeenParams({ location: params.location, filter: params.filter });
    if (params.location) {
      setView('location');
      setSelectedLoc(params.location);
    }
    if (params.filter) setFilter(params.filter);
  }

  const locs = activeLocations(snapshot);
  const searched = useMemo(
    () => snapshot.items.filter((s) => matchesSearch(query, s.item.name)),
    [snapshot, query],
  );

  const passes = (s: ItemSummary, f: Filter) => {
    switch (f) {
      case 'all':
        return true;
      case 'low':
        return s.isLow;
      case 'opened':
        return s.hasOpened;
      case 'out':
        return s.isOut;
      case 'expiring':
        return s.expiringLots.length > 0;
    }
  };

  const counts = useMemo(
    () => ({
      low: searched.filter((s) => s.isLow).length,
      opened: searched.filter((s) => s.hasOpened).length,
      out: searched.filter((s) => s.isOut).length,
      expiring: searched.filter((s) => s.expiringLots.length > 0).length,
    }),
    [searched],
  );

  const filtered = useMemo(() => {
    const list = searched.filter((s) => passes(s, filter));
    if (sort === 'recent') {
      return [...list].sort((a, b) => (b.item.lastActivityAt ?? '').localeCompare(a.item.lastActivityAt ?? ''));
    }
    return list;
  }, [searched, filter, sort]);

  const chipInfos: LocationChipInfo[] = useMemo(
    () =>
      locs.map((location) => {
        const here = snapshot.items.filter((s) => s.byLocation.some((b) => b.locationId === location.id && (b.qty > 0 || b.minQty != null)));
        return {
          location,
          itemCount: here.length,
          lowCount: here.filter((s) => s.byLocation.some((b) => b.locationId === location.id && b.low)).length,
        };
      }),
    [locs, snapshot],
  );

  const toBuy = filter === 'low' ? filtered.filter((s) => needsBuying(s) && !s.onShoppingList) : [];

  const whereText = (s: ItemSummary) => {
    if (filter === 'low') {
      const parts: string[] = [];
      for (const l of s.lowLocations) {
        const alert = l.minQty != null ? ` · alert ≤ ${formatQty(l.minQty)}` : '';
        parts.push(`${locationName(snapshot, l.locationId)} ${formatQty(l.qty)}${alert}`);
        const other = stockElsewhere(s, l.locationId);
        if (other.qty > 0) parts.push(`${formatQty(other.qty)} more in ${locationName(snapshot, other.bestLocationId)}`);
      }
      if (s.lowTotal) parts.push(`Total ${formatQty(s.total)} · alert ≤ ${formatQty(s.item.minTotal!)}`);
      return parts.join('\n');
    }
    if (filter === 'expiring') {
      return s.expiringLots
        .map((l) => `${locationName(snapshot, l.locationId)} · ${expiryStatusFor(l.expiresOn, snapshot.prefs.expiryWindowDays) === 'expired' ? 'expired' : 'expires'} ${formatShortDate(l.expiresOn!)}`)
        .join('\n');
    }
    const located = s.byLocation.filter((b) => b.qty > 0);
    if (located.length === 0) return 'None left';
    return located
      .map((b) => {
        const lvl = s.item.tracking === 'level' && b.qty < 1;
        return `${locationName(snapshot, b.locationId)} ${lvl ? levelLabel(b.qty) : formatQty(b.qty)}`;
      })
      .join(' · ');
  };

  const restock = (s: ItemSummary) => router.push(`/restock/${s.item.id}`);

  const FilterChips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
      <Chip label="Low stock" count={counts.low} selected={filter === 'low'} onPress={() => setFilter('low')} />
      <Chip label="Expiring soon" count={counts.expiring} selected={filter === 'expiring'} onPress={() => setFilter('expiring')} />
      <Chip label="Opened" count={counts.opened} selected={filter === 'opened'} onPress={() => setFilter('opened')} />
      <Chip label="Out" count={counts.out} selected={filter === 'out'} onPress={() => setFilter('out')} />
    </ScrollView>
  );

  return (
    <Screen>
      <Title>Inventory</Title>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: 'All locations' },
          { value: 'location', label: 'By location' },
        ]}
      />
      <SearchBox value={query} onChangeText={setQuery} placeholder="Search items" />

      {view === 'location' ? (
        <LocationChips infos={chipInfos} selected={selectedLoc} onSelect={setSelectedLoc} totalItems={snapshot.items.length} />
      ) : null}
      {FilterChips}

      {snapshot.items.length === 0 ? (
        <Card>
          <Empty
            title="Nothing here yet"
            body="Add items as you buy or unpack them."
            action={<Button label="Add item" variant="primary" onPress={() => router.push('/add')} />}
          />
        </Card>
      ) : view === 'all' ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={type.small}>
              {filtered.length} {filtered.length === 1 ? 'item' : 'items'} · {sort === 'az' ? 'sorted A–Z' : 'recently changed first'}
            </Text>
            <Button small variant="ghost" label={sort === 'az' ? 'Sort: A–Z' : 'Sort: Recent'} onPress={() => setSort(sort === 'az' ? 'recent' : 'az')} />
          </View>
          {filter === 'low' && filtered.length > 0 ? (
            <View style={{ backgroundColor: colors.lowSoft, borderRadius: 12, padding: 12 }}>
              <Text style={{ color: colors.lowText, fontSize: 13 }}>
                {filtered.length} {filtered.length === 1 ? 'item is' : 'items are'} at or below the alert level
              </Text>
            </View>
          ) : null}
          {filtered.length === 0 ? (
            <Card>
              <Row first>
                <Text style={type.meta}>No items match.</Text>
              </Row>
            </Card>
          ) : (
            <Card style={{ overflow: 'hidden' }}>
              {filtered.map((s, i) => (
                <SwipeRow key={s.item.id} actionLabel="Bought more" onAction={() => restock(s)}>
                  <ItemRow first={i === 0} summary={s} meta={whereText(s)} onPress={() => router.push(`/item/${s.item.id}`)} />
                </SwipeRow>
              ))}
            </Card>
          )}
          {filter === 'low' ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button style={{ flex: 1 }} label="Clear filter" onPress={() => setFilter('all')} />
              {toBuy.length > 0 ? (
                <Button
                  style={{ flex: 1 }}
                  variant="primary"
                  label={`Add ${toBuy.length} to list`}
                  onPress={() => {
                    mutate((c) => toBuy.forEach((s) => addToShoppingList(c, { name: s.item.name, itemId: s.item.id })));
                    showToast(`Added ${toBuy.length} to your shopping list`);
                  }}
                />
              ) : null}
            </View>
          ) : null}
          <Text style={[type.small, { textAlign: 'center' }]}>Tip: swipe an item left for Bought more.</Text>
        </>
      ) : (
        locs
          .filter((l) => !selectedLoc || l.id === selectedLoc)
          .map((l) => {
            const rows = searched
              .map((s) => ({ s, here: s.byLocation.find((b) => b.locationId === l.id) }))
              .filter(({ s, here }) => {
                if (!here || (here.qty <= 0 && here.minQty == null)) return false;
                switch (filter) {
                  case 'all':
                    return true;
                  case 'low':
                    return here.low;
                  case 'opened':
                    return tracksLotState(s.item) && here.lots.some((x) => x.state === 'opened');
                  case 'out':
                    return here.qty <= 0;
                  case 'expiring':
                    return s.expiringLots.some((x) => x.locationId === l.id);
                }
              });
            if (rows.length === 0 && (selectedLoc == null || filter !== 'all')) return null;
            const info = chipInfos.find((c) => c.location.id === l.id)!;
            return (
              <View key={l.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={type.heading}>{l.name}</Text>
                  <Text style={type.small}>
                    {info.itemCount} {info.itemCount === 1 ? 'item' : 'items'}
                    {info.lowCount ? ` · ${info.lowCount} low` : ''}
                  </Text>
                </View>
                <Card style={{ overflow: 'hidden' }}>
                  {rows.length === 0 ? (
                    <Row first>
                      <Text style={type.meta}>Nothing stored here yet.</Text>
                    </Row>
                  ) : (
                    rows.map(({ s, here }, i) => {
                      const states = tracksLotState(s.item)
                        ? [...new Set(here!.lots.map((x) => (x.state === 'opened' ? 'Opened' : 'Sealed')))].join(' · ')
                        : '';
                      const exp = here!.lots.find((x) => x.expiresOn)?.expiresOn;
                      const meta = [
                        here!.qty <= 0 ? 'None left' : states,
                        here!.minQty != null ? `alert ≤ ${formatQty(here!.minQty)}` : '',
                        exp ? `exp ${formatShortDate(exp)}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <SwipeRow key={s.item.id} actionLabel="Bought more" onAction={() => restock(s)}>
                          <ItemRow
                            first={i === 0}
                            summary={s}
                            qty={here!.qty}
                            low={here!.low}
                            meta={meta}
                            onPress={() => router.push(`/item/${s.item.id}`)}
                          />
                        </SwipeRow>
                      );
                    })
                  )}
                </Card>
              </View>
            );
          })
      )}
      {view === 'location' && selectedLoc == null && filter !== 'all' && searched.every((s) => !passes(s, filter)) ? (
        <Card>
          <Row first>
            <Text style={type.meta}>No items match.</Text>
          </Row>
        </Card>
      ) : null}
      {snapshot.items.length > 0 && view === 'all' && filter === 'all' && query === '' ? (
        <Text style={[type.small, { textAlign: 'center' }]}>
          {formatUnits(snapshot.items.length, 'item')} tracked across {locs.length} locations
        </Text>
      ) : null}
    </Screen>
  );
}
