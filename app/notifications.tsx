import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '@/state/AppContext';
import { Button, Card, Field, Input, Screen, SectionLabel, Segmented, ToggleRow } from '@/components/ui';
import { colors, type } from '@/theme';
import { activeLocations } from '@/services/snapshot';
import { updatePrefs } from '@/services/settings';
import { setLocationAlerts } from '@/services/locations';
import { hasPermission, requestPermission } from '@/notifications/notifier';
import { isValidTime, formatTime } from '@/lib/time';

export default function NotificationsScreen() {
  const { snapshot, mutate } = useApp();
  const { prefs } = snapshot;
  const locs = activeLocations(snapshot);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [digestTime, setDigestTime] = useState(prefs.digestTime);
  const [quietStart, setQuietStart] = useState(prefs.quietStart);
  const [quietEnd, setQuietEnd] = useState(prefs.quietEnd);

  useEffect(() => {
    hasPermission().then(setAllowed).catch(() => setAllowed(false));
  }, []);

  const thresholdCount = (locationId: string) => snapshot.settings.filter((s) => s.locationId === locationId && s.minQty != null).length;

  const saveTime = (key: 'digestTime' | 'quietStart' | 'quietEnd', value: string) => {
    if (isValidTime(value)) mutate((c) => updatePrefs(c, { [key]: value }));
  };

  return (
    <Screen edges={[]}>
      {allowed === false ? (
        <View style={{ backgroundColor: colors.lowSoft, borderRadius: 12, padding: 12, gap: 8 }}>
          <Text style={{ color: colors.lowText }}>Notifications are off for this app, so alerts only show inside the app.</Text>
          <Button small label="Allow notifications" onPress={() => requestPermission().then(setAllowed)} />
        </View>
      ) : null}

      <SectionLabel>Low-stock alerts by location</SectionLabel>
      <Card>
        {locs.map((l, i) => {
          const n = thresholdCount(l.id);
          return (
            <ToggleRow
              key={l.id}
              first={i === 0}
              label={l.name}
              sub={n === 0 ? 'No thresholds' : `${n} ${n === 1 ? 'threshold' : 'thresholds'}`}
              value={snapshot.locationAlertsEnabled.get(l.id) ?? true}
              onChange={(v) => mutate((c) => setLocationAlerts(c, l.id, v))}
            />
          );
        })}
      </Card>
      <Text style={type.small}>A location that’s switched off still shows its low items in the app, without a notification.</Text>

      <Card>
        <ToggleRow
          first
          label="Household total"
          sub="“Buy more” alerts"
          value={prefs.totalAlertsEnabled}
          onChange={(v) => mutate((c) => updatePrefs(c, { totalAlertsEnabled: v }))}
        />
        <ToggleRow
          label="Expiry alerts"
          sub="Items about to expire or expired"
          value={prefs.expiryAlertsEnabled}
          onChange={(v) => mutate((c) => updatePrefs(c, { expiryAlertsEnabled: v }))}
        />
      </Card>

      {prefs.expiryAlertsEnabled ? (
        <Field label="Warn me before expiry">
          <Segmented
            value={String(prefs.expiryWindowDays)}
            onChange={(v) => mutate((c) => updatePrefs(c, { expiryWindowDays: Number(v) }))}
            options={[
              { value: '1', label: '1 day' },
              { value: '3', label: '3 days' },
              { value: '7', label: '7 days' },
            ]}
          />
        </Field>
      ) : null}

      <SectionLabel>Delivery</SectionLabel>
      <Segmented
        value={prefs.mode}
        onChange={(v) => mutate((c) => updatePrefs(c, { mode: v }))}
        options={[
          { value: 'digest', label: 'Daily digest' },
          { value: 'instant', label: 'Instant' },
        ]}
      />
      {prefs.mode === 'digest' ? (
        <Field label="Digest time (24h, HH:MM)" hint={isValidTime(digestTime) ? `One notification at ${formatTime(digestTime)} listing everything that needs attention.` : 'Use 24-hour time, e.g. 08:00'}>
          <Input value={digestTime} onChangeText={setDigestTime} onEndEditing={() => saveTime('digestTime', digestTime)} keyboardType="numbers-and-punctuation" />
        </Field>
      ) : null}
      <Field label="Quiet hours (24h)" hint="Nothing is sent during quiet hours; alerts wait until they end.">
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Input style={{ flex: 1 }} value={quietStart} onChangeText={setQuietStart} onEndEditing={() => saveTime('quietStart', quietStart)} keyboardType="numbers-and-punctuation" accessibilityLabel="Quiet hours start" />
          <Text style={type.meta}>to</Text>
          <Input style={{ flex: 1 }} value={quietEnd} onChangeText={setQuietEnd} onEndEditing={() => saveTime('quietEnd', quietEnd)} keyboardType="numbers-and-punctuation" accessibilityLabel="Quiet hours end" />
        </View>
      </Field>
    </Screen>
  );
}
