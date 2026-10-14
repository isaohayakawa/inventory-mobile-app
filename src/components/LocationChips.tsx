import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Location } from '@/db/schema';
import { Chip, Row } from './ui';
import { Sheet } from './Sheet';
import { colors, radius, type } from '@/theme';

export interface LocationChipInfo {
  location: Location;
  itemCount: number;
  lowCount: number;
}

/**
 * Location chips for the By location view.
 * "All" is pinned on the left (it opens the full location sheet); the rest scroll sideways.
 * A cut-off chip, an edge fade, a › button and a thin scroll bar show there is more.
 */
export function LocationChips({
  infos,
  selected,
  onSelect,
  totalItems,
}: {
  infos: LocationChipInfo[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  totalItems: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const chipX = useRef(new Map<string, { x: number; w: number }>());
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Scroll the selected chip into view (e.g. when arriving from an alert).
  useEffect(() => {
    if (!selected || viewW === 0) return;
    const pos = chipX.current.get(selected);
    if (!pos) return;
    if (pos.x < offset || pos.x + pos.w > offset + viewW - 40) {
      scrollRef.current?.scrollTo({ x: Math.max(0, pos.x - 8), animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, viewW, contentW]);

  const scrollable = contentW > viewW + 1;
  const atEnd = offset + viewW >= contentW - 2;
  const thumbW = scrollable ? Math.max(24, (viewW / contentW) * viewW) : viewW;
  const thumbX = scrollable ? (offset / (contentW - viewW)) * (viewW - thumbW) : 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setOffset(e.nativeEvent.contentOffset.x);

  return (
    <View>
      <View style={styles.row}>
        <Chip
          label="All"
          count={infos.length}
          selected={selected == null}
          outlineSelected
          onPress={() => setSheetOpen(true)}
        />
        <View style={styles.divider} />
        <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width)}>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={(w) => setContentW(w)}
            contentContainerStyle={{ gap: 8, paddingRight: 48 }}
          >
            {infos.map((info) => (
              <View
                key={info.location.id}
                onLayout={(e) => chipX.current.set(info.location.id, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width })}
              >
                <Chip
                  label={info.location.name}
                  selected={selected === info.location.id}
                  outlineSelected
                  dot={info.lowCount > 0}
                  onPress={() => onSelect(selected === info.location.id ? null : info.location.id)}
                />
              </View>
            ))}
          </ScrollView>
          {scrollable && !atEnd ? (
            <View style={styles.fadeWrap} pointerEvents="box-none">
              <View pointerEvents="none" style={[styles.fade, { opacity: 0.35, width: 56 }]} />
              <View pointerEvents="none" style={[styles.fade, { opacity: 0.6, width: 44 }]} />
              <View pointerEvents="none" style={[styles.fade, { opacity: 0.9, width: 34 }]} />
              <Pressable
                onPress={() => scrollRef.current?.scrollTo({ x: Math.min(contentW - viewW, offset + viewW * 0.7), animated: true })}
                accessibilityRole="button"
                accessibilityLabel="Show more locations"
                style={styles.arrow}
                hitSlop={8}
              >
                <Ionicons name="chevron-forward" size={14} color={colors.text} />
              </Pressable>
            </View>
          ) : null}
          {scrollable ? (
            <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.thumb, { width: thumbW, left: thumbX }]} />
            </View>
          ) : null}
        </View>
      </View>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Jump to location">
        <View style={styles.list}>
          <Row
            first
            onPress={() => {
              onSelect(null);
              setSheetOpen(false);
            }}
            accessibilityLabel="All locations"
          >
            <Check on={selected == null} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, selected == null && { color: colors.accent }]}>All locations</Text>
              <Text style={type.small}>{totalItems} items</Text>
            </View>
          </Row>
          {infos.map((info) => (
            <Row
              key={info.location.id}
              onPress={() => {
                onSelect(info.location.id);
                setSheetOpen(false);
              }}
              accessibilityLabel={`${info.location.name}, ${info.itemCount} items${info.lowCount ? `, ${info.lowCount} low` : ''}`}
            >
              <Check on={selected === info.location.id} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, selected === info.location.id && { color: colors.accent }]}>{info.location.name}</Text>
                <Text style={type.small}>
                  {info.itemCount} {info.itemCount === 1 ? 'item' : 'items'}
                </Text>
              </View>
              {info.lowCount > 0 ? <Text style={styles.low}>{info.lowCount} low</Text> : null}
            </Row>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

function Check({ on }: { on: boolean }) {
  return <View style={{ width: 20 }}>{on ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divider: { width: 1, height: 28, backgroundColor: colors.inputBorder },
  fadeWrap: { position: 'absolute', right: 0, top: 0, height: 36, width: 56, justifyContent: 'center', alignItems: 'flex-end' },
  fade: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: colors.page },
  arrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginTop: 8, marginLeft: 0, overflow: 'hidden' },
  thumb: { position: 'absolute', top: 0, height: 3, borderRadius: 2, backgroundColor: '#99A0B2' },
  list: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  low: { fontSize: 13, fontWeight: '600', color: colors.low },
});
