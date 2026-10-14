/** Small set of UI primitives shared by every screen (indigo theme). */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type, HIT } from '@/theme';

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.screenContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <View style={{ marginTop: space.sm, marginBottom: space.xs }}>
      {sub ? <Text style={type.meta}>{sub}</Text> : null}
      <Text style={type.title} accessibilityRole="header">
        {children}
      </Text>
    </View>
  );
}

export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={type.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A row inside a Card; draws a divider above every row but the first. */
export function Row({
  children,
  first,
  onPress,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  first?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const content = <View style={[styles.row, !first && styles.rowDivider, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => <View style={{ opacity: pressed ? 0.6 : 1 }}>{content}</View>}
    </Pressable>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  icon,
  style,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={v.fg} /> : null}
      <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: v.fg }]}>{label}</Text>
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
  secondary: { bg: colors.card, fg: colors.text, border: colors.inputBorder },
  danger: { bg: colors.card, fg: colors.low, border: colors.inputBorder },
  ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
};

export function IconButton({
  icon,
  label,
  onPress,
  color = colors.accent,
  size = 18,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Chip({
  label,
  count,
  selected,
  onPress,
  dot,
  outlineSelected,
}: {
  label: string;
  count?: number;
  selected?: boolean;
  onPress?: () => void;
  dot?: boolean;
  /** Selected style as an outline (location chips) instead of a fill (filter chips). */
  outlineSelected?: boolean;
}) {
  const filled = selected && !outlineSelected;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${count != null ? `, ${count}` : ''}${dot ? ', has low items' : ''}`}
      style={[
        styles.chip,
        filled && { backgroundColor: colors.accent, borderColor: colors.accent },
        selected && outlineSelected && { borderColor: colors.accent, borderWidth: 2, paddingHorizontal: 11 },
      ]}
    >
      <Text style={[styles.chipText, filled && { color: colors.onAccent, fontWeight: '600' }, selected && outlineSelected && { fontWeight: '600' }]}>
        {label}
      </Text>
      {count != null ? (
        <Text style={[styles.chipCount, filled && { color: colors.onAccent }]}>{count}</Text>
      ) : null}
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segmentItem, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && { color: colors.text, fontWeight: '600' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

export const Input = React.forwardRef<TextInput, TextInputProps & { focused?: boolean }>(function Input(
  { style, focused, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textTertiary}
      style={[styles.input, focused && { borderColor: colors.accent, borderWidth: 2 }, style]}
      {...props}
    />
  );
});

export function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        style={styles.searchInput}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

export function Stepper({ value, onChange, min = 1, label }: { value: number; onChange: (n: number) => void; min?: number; label: string }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={styles.stepBtn}
      >
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${label} ${value}`}>
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(value + 1)}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={styles.stepBtn}
      >
        <Ionicons name="add" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

export function ToggleRow({
  label,
  sub,
  value,
  onChange,
  first,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  first?: boolean;
}) {
  return (
    <Row first={first}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        {sub ? <Text style={type.small}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.inputBorder }}
        thumbColor="#FFFFFF"
        accessibilityLabel={label}
      />
    </Row>
  );
}

/** Rounded initials tile used in item rows. */
export function Thumb({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.thumbText}>{initials}</Text>
    </View>
  );
}

export function Tag({ label, tone }: { label: string; tone: 'sealed' | 'opened' | 'low' | 'neutral' }) {
  const t = {
    sealed: [colors.sealedSoft, colors.sealed],
    opened: [colors.openedSoft, colors.opened],
    low: [colors.lowSoft, colors.lowText],
    neutral: [colors.subtle, colors.textSecondary],
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: t[0] }]}>
      <Text style={[styles.tagText, { color: t[1] }]}>{label}</Text>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={type.heading}>{title}</Text>
      {body ? <Text style={[type.meta, { textAlign: 'center' }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function Pill({ label, onPress, solid }: { label: string; onPress: () => void } & Pick<PressableProps, never> & { solid?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.pill, solid && { backgroundColor: colors.accent, borderColor: colors.accent }, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.pillText, solid && { color: colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  screenContent: { padding: space.lg, paddingBottom: 48, gap: space.md },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 11, minHeight: HIT },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  button: {
    minHeight: HIT + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill },
  buttonText: { fontSize: 15, fontWeight: '600' },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  chipCount: { fontSize: 12, color: colors.textSecondary },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.low },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.md, padding: 4 },
  segmentItem: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentOn: {
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  input: {
    minHeight: HIT + 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: HIT + 4,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  stepBtn: { width: HIT + 4, height: HIT + 4, alignItems: 'center', justifyContent: 'center' },
  stepValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.divider,
    lineHeight: HIT + 4,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: { fontSize: 13, fontWeight: '700', color: colors.accent },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: 40, paddingHorizontal: space.xl },
  pill: {
    paddingHorizontal: 12,
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.card,
  },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.text },
});
