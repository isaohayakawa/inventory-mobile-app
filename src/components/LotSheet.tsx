import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { Item, StockLot } from '@/db/schema';
import { Sheet } from './Sheet';
import { Button, Field, Input, Segmented, Stepper } from './ui';
import { DateInput, LocationSelect } from './pickers';
import { type } from '@/theme';
import { useApp } from '@/state/AppContext';
import { activeLocations, expiryStatusFor, locationName } from '@/services/snapshot';
import { correctLot, moveStock, openPack, removeStock, setLevel, setLotExpiry, consumeOne, type RemoveReason } from '@/services/inventory';
import { describeLot, formatUnits, LEVELS, levelLabel, unitsPerPackage } from '@/domain/quantity';
import { formatShortDate } from '@/lib/time';

type Mode = 'menu' | 'move' | 'fix' | 'expiry' | 'remove' | 'open';

/** Everything you can do with one stock lot: use, set level, open, move, fix count, expiry, remove. */
export function LotSheet({ lot, item, onClose, moveCount }: LotSheetProps & { lot: StockLot | null }) {
  if (!lot) return null;
  // Keyed by lot so every opened lot starts with fresh state.
  return <LotSheetContent key={lot.id} lot={lot} item={item} onClose={onClose} moveCount={moveCount} />;
}

interface LotSheetProps {
  item: Item;
  onClose: () => void;
  /** Opens straight into Move with this many (packs or units) preselected, e.g. to fix where stock was just added. */
  moveCount?: number;
}

function LotSheetContent({ lot, item, onClose, moveCount: initialMoveCount }: LotSheetProps & { lot: StockLot }) {
  const { snapshot, mutate, showToast } = useApp();
  const [mode, setMode] = useState<Mode>(initialMoveCount ? 'move' : 'menu');
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(initialMoveCount ?? 1);
  const [openTo, setOpenTo] = useState<string | null>(lot.locationId);
  const [fixText, setFixText] = useState(() => String(Math.round(lot.qtyBase * 100) / 100));
  const [expiry, setExpiry] = useState<string | null>(lot.expiresOn);

  const locs = activeLocations(snapshot);
  const pkgs = snapshot.packages;
  const pkg = lot.packageId ? pkgs.get(lot.packageId) : undefined;
  const unit = lot.state === 'sealed' ? unitsPerPackage(lot.packageId, pkgs) : 1;
  const isPack = lot.state === 'sealed' && unit > 1;
  const isLevel = item.tracking === 'level' && lot.state === 'opened' && lot.qtyBase <= 1;
  const maxMove = isPack ? Math.round(lot.qtyBase / unit) : Math.floor(lot.qtyBase) || 1;
  const status = expiryStatusFor(lot.expiresOn, snapshot.prefs.expiryWindowDays);
  const done = (msg?: string) => {
    if (msg) showToast(msg);
    onClose();
  };

  const title = `${item.name} · ${locationName(snapshot, lot.locationId)}`;

  return (
    <Sheet visible onClose={onClose} title={title}>
      <Text style={type.meta}>
        {lot.state === 'sealed' ? 'Sealed' : 'Opened'} · {describeLot(lot, item, pkgs)}
        {lot.expiresOn ? ` · ${status === 'expired' ? 'expired' : 'expires'} ${formatShortDate(lot.expiresOn)}` : ''}
      </Text>

      {mode === 'menu' ? (
        <View style={{ gap: 10 }}>
          {status === 'expired' ? (
            <>
              <Button label="Used it" variant="primary" onPress={() => { mutate((c) => removeStock(c, { lotId: lot.id, reason: 'used_up' })); done(); }} />
              <Button label="Throw out" variant="danger" onPress={() => { mutate((c) => removeStock(c, { lotId: lot.id, reason: 'expired' })); done(); }} />
              <Button label="Still good" onPress={() => { mutate((c) => setLotExpiry(c, { lotId: lot.id, expiresOn: null })); done('Expiry date cleared'); }} />
            </>
          ) : null}
          {isLevel ? (
            <View style={{ gap: 6 }}>
              <Text style={type.small}>How full is it now? Currently {levelLabel(lot.qtyBase)}.</Text>
              <Segmented
                value={String(LEVELS.find((l) => levelLabel(l.value) === levelLabel(lot.qtyBase))?.value ?? 1)}
                onChange={(v) => {
                  mutate((c) => setLevel(c, { lotId: lot.id, level: Number(v) }));
                  done();
                }}
                options={LEVELS.map((l) => ({ value: String(l.value), label: l.label }))}
              />
            </View>
          ) : !isPack ? (
            <Button
              label={`Used 1 ${item.baseUnit}`}
              variant={status === 'expired' ? 'secondary' : 'primary'}
              onPress={() => {
                mutate((c) => consumeOne(c, { itemId: item.id, lotId: lot.id }));
                done();
              }}
            />
          ) : null}
          {lot.state === 'sealed' ? (
            <Button label={`Open ${isPack ? `one ${pkg?.name ?? 'pack'}` : `a ${item.baseUnit}`}`} onPress={() => setMode('open')} />
          ) : null}
          <Button label="Move…" onPress={() => setMode('move')} />
          <Button label="Fix count" onPress={() => setMode('fix')} />
          <Button label={lot.expiresOn ? 'Change expiry date' : 'Add expiry date'} onPress={() => setMode('expiry')} />
          <Button label="Remove…" variant="danger" onPress={() => setMode('remove')} />
        </View>
      ) : null}

      {mode === 'open' ? (
        <View style={{ gap: 12 }}>
          <Field label="Put the opened stock in">
            <LocationSelect value={openTo} locations={locs} onChange={setOpenTo} />
          </Field>
          <Button
            label="Open"
            variant="primary"
            onPress={() => {
              mutate((c) => openPack(c, { lotId: lot.id, toLocationId: openTo ?? lot.locationId }));
              done(`Opened ${pkg?.name ?? item.baseUnit}`);
            }}
          />
          <Button variant="ghost" label="Back" onPress={() => setMode('menu')} />
        </View>
      ) : null}

      {mode === 'move' ? (
        <View style={{ gap: 12 }}>
          <Field
            label={isPack ? `How many ${pkg?.name ?? 'packs'}?` : `How many ${item.baseUnit}s?`}
            hint={`= ${formatUnits(Math.min(moveCount, maxMove) * unit, item.baseUnit)} of ${formatUnits(lot.qtyBase, item.baseUnit)}`}
          >
            {isLevel ? <Text style={type.meta}>Moves the whole opened {item.baseUnit}.</Text> : (
              <Stepper value={Math.min(moveCount, maxMove)} onChange={(n) => setMoveCount(Math.min(n, maxMove))} label="Move quantity" />
            )}
          </Field>
          <Field label="To">
            <LocationSelect value={moveTo} locations={locs} onChange={setMoveTo} exclude={lot.locationId} />
          </Field>
          <Button
            label="Move"
            variant="primary"
            disabled={!moveTo}
            onPress={() => {
              const qty = isLevel ? lot.qtyBase : Math.min(moveCount, maxMove) * unit;
              mutate((c) => moveStock(c, { lotId: lot.id, toLocationId: moveTo!, qty: Math.min(qty, lot.qtyBase) }));
              done(`Moved to ${locationName(snapshot, moveTo)}`);
            }}
          />
          <Button variant="ghost" label="Back" onPress={() => setMode('menu')} />
        </View>
      ) : null}

      {mode === 'fix' ? (
        <View style={{ gap: 12 }}>
          <Field label={`Actual count (${item.baseUnit}s)`} hint={isLevel ? 'For an opened bottle use 0.25, 0.5, 0.75 or 1.' : undefined}>
            <Input value={fixText} onChangeText={setFixText} keyboardType="decimal-pad" autoFocus />
          </Field>
          <Button
            label="Save count"
            variant="primary"
            onPress={() => {
              const n = Number(fixText);
              if (Number.isNaN(n) || n < 0) return;
              mutate((c) => correctLot(c, { lotId: lot.id, newQty: n }));
              done('Count updated');
            }}
          />
          <Button variant="ghost" label="Back" onPress={() => setMode('menu')} />
        </View>
      ) : null}

      {mode === 'expiry' ? (
        <View style={{ gap: 12 }}>
          <DateInput value={expiry} onChange={setExpiry} />
          <Button
            label="Save date"
            variant="primary"
            onPress={() => {
              mutate((c) => setLotExpiry(c, { lotId: lot.id, expiresOn: expiry }));
              done();
            }}
          />
          <Button variant="ghost" label="Back" onPress={() => setMode('menu')} />
        </View>
      ) : null}

      {mode === 'remove' ? (
        <View style={{ gap: 10 }}>
          <Text style={type.small}>Removes all {formatUnits(lot.qtyBase, item.baseUnit)} here. Why?</Text>
          {(
            [
              ['used_up', 'Used it up'],
              ['thrown_out', 'Threw it out'],
              ['expired', 'It expired'],
              ['unknown', "Don't know"],
            ] as [RemoveReason, string][]
          ).map(([reason, label]) => (
            <Button
              key={reason}
              label={label}
              onPress={() => {
                mutate((c) => removeStock(c, { lotId: lot.id, reason }));
                done('Removed');
              }}
            />
          ))}
          <Button variant="ghost" label="Back" onPress={() => setMode('menu')} />
        </View>
      ) : null}
    </Sheet>
  );
}
