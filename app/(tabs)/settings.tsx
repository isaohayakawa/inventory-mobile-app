import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/state/AppContext';
import { Card, Field, Pill, Row, Screen, SectionLabel, Segmented, Title } from '@/components/ui';
import { colors, type } from '@/theme';
import { getUnitSystem, setUnitSystem } from '@/services/settings';
import { activeLocations } from '@/services/snapshot';
import { restoreItem } from '@/services/inventory';

export default function SettingsScreen() {
  const { ctx, snapshot, mutate } = useApp();
  const [units, setUnits] = useState(getUnitSystem(ctx));
  const locCount = activeLocations(snapshot).length;

  const link = (label: string, sub: string, href: '/locations' | '/notifications', first?: boolean) => (
    <Row first={first} onPress={() => router.push(href)} accessibilityLabel={label}>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{label}</Text>
        <Text style={type.small}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Row>
  );

  return (
    <Screen>
      <Title>Settings</Title>
      <Card>
        {link('Locations', `${locCount} locations · add, rename, reorder, delete`, '/locations', true)}
        {link('Notifications', snapshot.prefs.mode === 'digest' ? `Daily digest at ${snapshot.prefs.digestTime}` : 'Instant alerts', '/notifications')}
      </Card>

      <Field label="Size units shown first" hint="Both metric and imperial are always available when you enter a size.">
        <Segmented
          value={units}
          onChange={(v) => {
            setUnits(v);
            mutate((c) => setUnitSystem(c, v));
          }}
          options={[
            { value: 'imperial', label: 'Imperial (oz, lb)' },
            { value: 'metric', label: 'Metric (ml, g)' },
          ]}
        />
      </Field>

      {snapshot.archivedItems.length > 0 ? (
        <>
          <SectionLabel>Archived items</SectionLabel>
          <Card>
            {snapshot.archivedItems.map((i, idx) => (
              <Row key={i.id} first={idx === 0}>
                <Text style={[type.body, { flex: 1 }]}>{i.name}</Text>
                <Pill label="Restore" onPress={() => mutate((c) => restoreItem(c, i.id))} />
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      <SectionLabel>Your data</SectionLabel>
      <Card>
        <Row first>
          <Text style={[type.meta, { flex: 1 }]}>
            Everything is stored on this phone only. There’s no account and nothing is sent anywhere. Your phone’s own backup (iCloud or
            Google) includes it.
          </Text>
        </Row>
      </Card>
    </Screen>
  );
}
