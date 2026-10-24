import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { Ctx } from '@/db/client';
import { loadSnapshot, type Snapshot } from '@/services/snapshot';
import type { MutationResult } from '@/services/inventory';
import { evaluateLowStock } from '@/services/alerts';
import { deliverLowStock, requestPermission, rescheduleAll } from '@/notifications/notifier';
import { ZeroPrompt } from '@/components/ZeroPrompt';
import { Toast, type ToastAction } from '@/components/Toast';

interface ToastState {
  message: string;
  actions: ToastAction[];
  key: number;
}

interface AppValue {
  ctx: Ctx;
  snapshot: Snapshot;
  /** Increments after every change; screens use it to re-query. */
  version: number;
  /**
   * Runs a change, then refreshes screens, checks low-stock alerts, asks about
   * items that reached 0, and reschedules notifications. Errors are shown to the user.
   */
  mutate: <T>(fn: (ctx: Ctx) => T) => T | undefined;
  refresh: () => void;
  showToast: (message: string, ...actions: ToastAction[]) => void;
}

const AppContext = createContext<AppValue | null>(null);

function isMutationResult(x: unknown): x is MutationResult {
  return !!x && typeof x === 'object' && 'itemIds' in x && 'zeroed' in x;
}

export function AppProvider({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const [zeroQueue, setZeroQueue] = useState<string[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  // `version` is the signal that the database changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => loadSnapshot(ctx), [ctx, version]);
  const rescheduleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReschedule = useCallback(() => {
    if (rescheduleTimer.current) clearTimeout(rescheduleTimer.current);
    rescheduleTimer.current = setTimeout(() => {
      rescheduleAll(loadSnapshot(ctx)).catch((e) => console.warn('reschedule failed', e));
    }, 800);
  }, [ctx]);

  // Recompute digest/expiry notifications on launch (content may be stale).
  useEffect(() => {
    scheduleReschedule();
  }, [scheduleReschedule]);

  // Ask for notification permission once there is something to be alerted about.
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || snapshot.items.length === 0) return;
    askedRef.current = true;
    requestPermission()
      .then((ok) => ok && scheduleReschedule())
      .catch((e) => console.warn('permission request failed', e));
  }, [snapshot.items.length, scheduleReschedule]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const mutate = useCallback(
    <T,>(fn: (c: Ctx) => T): T | undefined => {
      let result: T;
      try {
        result = fn(ctx);
      } catch (e) {
        Alert.alert("Couldn't do that", e instanceof Error ? e.message : String(e));
        return undefined;
      }
      setVersion((v) => v + 1);
      if (isMutationResult(result)) {
        if (result.itemIds.length > 0) {
          try {
            const fresh = loadSnapshot(ctx);
            const alerts = evaluateLowStock(ctx, result.itemIds, fresh);
            deliverLowStock(alerts, fresh).catch((e) => console.warn('notify failed', e));
          } catch (e) {
            console.warn('alert check failed', e);
          }
        }
        if (result.zeroed.length > 0) {
          setZeroQueue((q) => [...q, ...result.zeroed.filter((id) => !q.includes(id))]);
        }
      }
      scheduleReschedule();
      return result;
    },
    [ctx, scheduleReschedule],
  );

  const showToast = useCallback((message: string, ...actions: ToastAction[]) => {
    setToast({ message, actions, key: Date.now() });
  }, []);

  const value = useMemo<AppValue>(
    () => ({ ctx, snapshot, version, mutate, refresh, showToast }),
    [ctx, snapshot, version, mutate, refresh, showToast],
  );

  // First queued item that is still active and still at 0 (others were restocked or archived meanwhile).
  const zeroItem = zeroQueue
    .map((id) => snapshot.items.find((s) => s.item.id === id))
    .find((s) => s && s.isOut && !s.item.alwaysKeep)?.item;

  return (
    <AppContext.Provider value={value}>
      {children}
      {zeroItem && (
        <ZeroPrompt
          item={zeroItem}
          onDone={() => {
            setZeroQueue((q) => q.filter((id) => id !== zeroItem.id));
          }}
        />
      )}
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          actions={toast.actions}
          onHide={() => setToast(null)}
        />
      )}
    </AppContext.Provider>
  );
}

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
