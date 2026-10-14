# Home Inventory (MVP)

A mobile-first household inventory app: know what you'll need before you run out.
React Native (Expo SDK 57) + TypeScript, with all data stored locally on the phone.

## Run it

```bash
npm install            # .npmrc sets legacy-peer-deps (an Expo/react-dom peer quirk)
npx expo start         # scan the QR code with Expo Go (SDK 57), or press i / a
```

Everything in the MVP (SQLite, local notifications) works in Expo Go. For a
store build use EAS: `npx eas-cli@latest build`.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Service tests against a real SQLite database (better-sqlite3) with the real migrations |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint with `eslint-config-expo` |
| `npm run db:generate` | Generate a new Drizzle migration after changing `src/db/schema.ts` |

## How it's built

```
app/                    Expo Router screens
  (tabs)/index.tsx      Home: "Do we have…?", Needs attention, Recently used
  (tabs)/inventory.tsx  All locations / By location, filters, scrolling location chips
  (tabs)/list.tsx       Shopping list + "You may want to buy"
  (tabs)/settings.tsx   Locations, notifications, units, archived items
  add.tsx               Manual entry with autocomplete
  restock/[id].tsx      Bought more (prefilled, with Undo)
  item/[id].tsx         Item detail: total, lots by location, history
  item-settings/[id]    Name, unit, level tracking, thresholds per location, packages, archive
  locations/            Manage locations; delete through the moving summary
  notifications.tsx     Per-location switches, expiry window, digest/instant, quiet hours
src/db/                 Drizzle schema, first-run seed
src/services/           All business rules (no React): inventory, locations, alerts, search, shopping
src/domain/quantity.ts  Package math and display formatting
src/notifications/      expo-notifications delivery (local only)
src/state/AppContext    Runs changes, refreshes screens, alerts, zero-stock prompt, toasts
drizzle/                Generated SQL migrations (bundled into the app)
tests/                  Vitest tests for the services
```

### Data rules (from the spec)

- **Household-owned data**: a household of one is created on first launch. No account, no server.
- **Base units everywhere**: quantities are stored in the smallest unit (rolls). Packages nest
  (case → 6-pack → roll) and are only for entry and display.
- **Stock lots**: one per location / package / sealed-or-opened / expiry date. Same package,
  location and date merge; different dates stay separate.
- **Event log**: every change writes an append-only `inventory_event` in the same transaction
  as the lot update. Mistakes are fixed with `corrected` events.
- **First expired, first out**: "Used 1" takes from opened stock first, then the soonest expiry,
  opening a pack automatically when needed.
- **Zero stock**: when an item hits 0 everywhere you choose keep / shopping list / archive
  (dismiss = keep; "Always keep" stops asking).
- **Locations** are archived, never hard-deleted, so history keeps their names.

### Notifications

All local. Low-stock alerts fire once when a threshold is crossed and don't repeat until stock
recovers (`alert_state`). Instant mode shows them right away (or when quiet hours end) and
schedules expiry alerts per lot. Digest mode schedules one daily notification; its content is
rebuilt whenever the inventory changes or the app opens, so if the app isn't opened for several
days, later digests aren't sent until it is.

## Differences from the spec worth knowing

- **No separate `product` table.** With manual entry only, size lives on the item and packages
  belong to the item. `package.gtin` is reserved for barcode scanning; a shared product catalog
  can be added then.
- **Expiry date entry** is a typed date (YYYY-MM-DD) plus quick choices (+3 days … +1 year),
  to avoid another native dependency. A native date picker can replace it later.
- **Swipe for Bought more** is built with React Native's PanResponder (no gesture library).
- **Threshold "Keep" level** (target quantity) is implemented, so move suggestions say how many to move.

## Still to decide (outside the codebase)

App store setup, confirming backup includes `inventory.db` (Android Auto Backup rules),
crash reporting/analytics, and an export/import file. See the spec's "MVP scope" section.
