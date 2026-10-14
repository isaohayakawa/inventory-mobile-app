/**
 * UUIDs are generated on the device so records never clash once cloud sync arrives.
 * The app registers expo-crypto's generator at startup; tests use Node's crypto.
 */
let generator: (() => string) | null = null;

export function configureIdGenerator(fn: () => string) {
  generator = fn;
}

export function newId(): string {
  if (generator) return generator();
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  throw new Error('No UUID generator configured');
}
