import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { openDatabaseAsync, openDatabaseSync } from 'expo-sqlite';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import * as Crypto from 'expo-crypto';
import migrations from '../drizzle/migrations';
import * as schema from '@/db/schema';
import type { Ctx, Db } from '@/db/client';
import { ensureHousehold } from '@/db/seed';
import { configureIdGenerator } from '@/lib/id';
import { AppProvider } from '@/state/AppContext';
import { setupNotifications } from '@/notifications/notifier';
import { colors, type } from '@/theme';

configureIdGenerator(() => Crypto.randomUUID());
setupNotifications().catch((e) => console.warn('notification setup failed', e));

type AppDb = ExpoSQLiteDatabase<typeof schema>;

// The only database: a SQLite file on the phone (backed up by iCloud / Android Auto Backup).
async function openAppDb(): Promise<AppDb> {
  if (Platform.OS === 'web') {
    // On web, expo-sqlite runs in a worker and sync calls only wait a few ms for it,
    // so the first sync call fails while the worker is still loading. Start it with
    // an async call first.
    const warmup = await openDatabaseAsync(':memory:');
    await warmup.closeAsync();
  }
  const expoDb = openDatabaseSync('inventory.db');
  expoDb.execSync('PRAGMA foreign_keys = ON;');
  return drizzle(expoDb, { schema });
}

const dbPromise = openAppDb();

export default function RootLayout() {
  const [db, setDb] = useState<AppDb | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    dbPromise.then(setDb, setError);
  }, []);

  if (error) return <OpenError error={error} />;
  if (!db) return <Loading />;
  return <MigratedApp db={db} />;
}

function OpenError({ error }: { error: Error }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.page }}>
      <Text style={type.heading}>Couldn’t open your inventory</Text>
      <Text style={[type.meta, { textAlign: 'center', marginTop: 8 }]}>{error.message}</Text>
    </View>
  );
}

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.page }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

function MigratedApp({ db }: { db: AppDb }) {
  const { success, error } = useMigrations(db, migrations);

  const ctx = useMemo<Ctx | null>(() => {
    if (!success) return null;
    const ids = ensureHousehold(db as unknown as Db);
    return { db: db as unknown as Db, ...ids };
  }, [db, success]);

  if (error) return <OpenError error={error} />;
  if (!ctx) return <Loading />;

  return (
    <SafeAreaProvider>
      <AppProvider ctx={ctx}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.page },
            headerTintColor: colors.accent,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.page },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add" options={{ presentation: 'modal', title: 'Add item' }} />
          <Stack.Screen name="restock/[id]" options={{ presentation: 'modal', title: 'Bought more' }} />
          <Stack.Screen name="item/[id]" options={{ title: '' }} />
          <Stack.Screen name="item-settings/[id]" options={{ title: 'Item settings' }} />
          <Stack.Screen name="locations/index" options={{ title: 'Locations' }} />
          <Stack.Screen name="locations/delete/[id]" options={{ title: 'Delete location' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
