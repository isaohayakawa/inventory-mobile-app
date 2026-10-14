import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Location } from '@/db/schema';
import { Chip, Input, Row } from './ui';
import { Sheet } from './Sheet';
import { colors, radius, type, HIT } from '@/theme';
import { addDays, formatShortDate, isValidDateString, today } from '@/lib/time';

/** Tappable field that opens a list to choose from. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string; sub?: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        style={styles.select}
      >
        <Text style={[type.body, { fontSize: 16 }, !current && { color: colors.textTertiary }]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <View style={styles.list}>
          {options.map((o, i) => (
            <Row
              key={o.value}
              first={i === 0}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              accessibilityLabel={o.label}
            >
              <View style={{ width: 20 }}>
                {o.value === value ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, o.value === value && { color: colors.accent, fontWeight: '600' }]}>{o.label}</Text>
                {o.sub ? <Text style={type.small}>{o.sub}</Text> : null}
              </View>
            </Row>
          ))}
        </View>
      </Sheet>
    </>
  );
}

export function LocationSelect({
  label = 'Location',
  value,
  locations,
  onChange,
  exclude,
}: {
  label?: string;
  value: string | null;
  locations: Location[];
  onChange: (id: string) => void;
  exclude?: string;
}) {
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={locations.filter((l) => !l.archivedAt && l.id !== exclude).map((l) => ({ value: l.id, label: l.name }))}
    />
  );
}

/**
 * Optional expiry date: quick choices plus a typed date (YYYY-MM-DD).
 * Kept dependency-free; swap in a native date picker later if wanted.
 */
export function DateInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  const quick: [string, number][] = [
    ['+3 days', 3],
    ['+1 week', 7],
    ['+1 month', 30],
    ['+6 months', 182],
    ['+1 year', 365],
  ];
  const set = (v: string | null) => {
    setText(v ?? '');
    onChange(v);
  };
  const invalid = text.length > 0 && !isValidDateString(text);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Input
          style={{ flex: 1 }}
          value={text}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          accessibilityLabel="Expiry date"
          onChangeText={(t) => {
            setText(t);
            if (t === '') onChange(null);
            else if (isValidDateString(t)) onChange(t);
          }}
        />
        {text ? (
          <Pressable onPress={() => set(null)} accessibilityRole="button" accessibilityLabel="Clear date" hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      {invalid ? <Text style={[type.small, { color: colors.low }]}>Use the format 2026-10-31</Text> : null}
      {value && !invalid ? <Text style={type.small}>Expires {formatShortDate(value)}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {quick.map(([label, days]) => (
          <Chip key={label} label={label} onPress={() => set(addDays(today(), days))} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  select: {
    minHeight: HIT + 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  list: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
});
