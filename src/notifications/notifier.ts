/**
 * Local notification delivery. Everything runs on the device; there is no push server.
 *
 * - Instant mode: low-stock alerts are shown when a quantity crosses a threshold
 *   (delayed to the end of quiet hours if needed); expiry alerts are scheduled per lot.
 * - Digest mode: one notification at the digest time listing everything that needs attention.
 *   Its content is recomputed whenever the inventory changes or the app opens.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { AlertMessage } from '@/services/alerts';
import { buildDigest, expiryAlertPlans } from '@/services/alerts';
import type { Snapshot } from '@/services/snapshot';
import { now, nextAllowedTime, nextOccurrence } from '@/lib/time';

const CHANNEL = 'inventory';
const DIGEST_ID = 'digest';
const EXPIRY_PREFIX = 'expiry-';
/** iOS keeps at most 64 pending local notifications per app. */
const MAX_SCHEDULED = 50;

let configured = false;

export async function setupNotifications(): Promise<void> {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Inventory alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function hasPermission(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync();
  return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function requestPermission(): Promise<boolean> {
  if (await hasPermission()) return true;
  const res = await Notifications.requestPermissionsAsync();
  return res.granted || res.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

function trigger(at: Date): Notifications.NotificationTriggerInput {
  if (at.getTime() <= Date.now() + 1000) return null;
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL };
}

/** Sends newly crossed low-stock alerts (instant mode only; digest mode collects them). */
export async function deliverLowStock(alerts: AlertMessage[], snapshot: Snapshot): Promise<void> {
  if (alerts.length === 0 || snapshot.prefs.mode !== 'instant') return;
  if (!(await hasPermission())) return;
  const at = nextAllowedTime(now(), snapshot.prefs.quietStart, snapshot.prefs.quietEnd);
  for (const a of alerts) {
    await Notifications.scheduleNotificationAsync({
      identifier: `low-${a.itemId}-${a.scope}`,
      content: { title: a.title, body: a.body, data: { itemId: a.itemId } },
      trigger: trigger(at),
    });
  }
}

/** Rebuilds the digest and expiry notifications from the current inventory. */
export async function rescheduleAll(snapshot: Snapshot): Promise<void> {
  if (!(await hasPermission())) return;
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const p of pending) {
    if (p.identifier === DIGEST_ID || p.identifier.startsWith(EXPIRY_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(p.identifier);
    }
  }
  const { prefs } = snapshot;
  const current = now();

  if (prefs.mode === 'digest') {
    const digest = buildDigest(snapshot);
    if (!digest) return;
    const at = nextAllowedTime(nextOccurrence(current, prefs.digestTime), prefs.quietStart, prefs.quietEnd);
    await Notifications.scheduleNotificationAsync({
      identifier: DIGEST_ID,
      content: { title: digest.title, body: digest.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
    return;
  }

  const plans = expiryAlertPlans(snapshot)
    .map((p) => ({ ...p, at: nextAllowedTime(p.at, prefs.quietStart, prefs.quietEnd) }))
    .filter((p) => p.at.getTime() > current.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_SCHEDULED);
  let i = 0;
  for (const p of plans) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${EXPIRY_PREFIX}${p.lotId}-${i++}`,
      content: { title: p.title, body: p.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL },
    });
  }
}
