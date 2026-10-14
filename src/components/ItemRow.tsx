import React from 'react';
import { Text, View } from 'react-native';
import { Row, Thumb } from './ui';
import { colors, type } from '@/theme';
import { formatQty, plural, levelLabel } from '@/domain/quantity';
import type { ItemSummary } from '@/services/snapshot';

/** Quantity text with the right color for low / out. */
export function QtyBlock({ qty, unit, low, out, levelOnly }: { qty: number; unit: string; low?: boolean; out?: boolean; levelOnly?: boolean }) {
  const color = out ? colors.out : low ? colors.low : colors.text;
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={{ fontSize: 15, fontWeight: '600', color }}>{levelOnly ? levelLabel(qty) : formatQty(qty)}</Text>
      <Text style={type.small}>{levelOnly ? `opened ${unit}` : plural(unit, qty === 1 ? 1 : 2)}</Text>
    </View>
  );
}

export function ItemRow({
  summary,
  meta,
  qty,
  first,
  onPress,
  right,
  low,
}: {
  summary: ItemSummary;
  meta: React.ReactNode;
  qty?: number;
  first?: boolean;
  onPress?: () => void;
  right?: React.ReactNode;
  low?: boolean;
}) {
  const q = qty ?? summary.total;
  const levelOnly = summary.item.tracking === 'level' && q > 0 && q < 1;
  return (
    <Row first={first} onPress={onPress} accessibilityLabel={`${summary.item.name}, ${formatQty(q)} ${summary.item.baseUnit}`}>
      <Thumb name={summary.item.name} />
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {summary.item.name}
        </Text>
        {typeof meta === 'string' ? (
          <Text style={[type.small, { marginTop: 2 }]} numberOfLines={2}>
            {meta}
          </Text>
        ) : (
          meta
        )}
      </View>
      <QtyBlock qty={q} unit={summary.item.baseUnit} low={low ?? summary.isLow} out={q <= 0} levelOnly={levelOnly} />
      {right}
    </Row>
  );
}
