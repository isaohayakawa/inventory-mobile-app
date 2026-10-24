import type { Package, StockLot, Item } from '@/db/schema';

export type PackageMap = Map<string, Package>;

/** How many base units one package holds, following nested packages. */
export function unitsPerPackage(pkgId: string | null | undefined, packages: PackageMap): number {
  if (!pkgId) return 1;
  let units = 1;
  let current = packages.get(pkgId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break; // guard against bad data
    seen.add(current.id);
    units *= current.containsQty;
    current = current.containsPackageId ? packages.get(current.containsPackageId) : undefined;
  }
  return units;
}

export function plural(word: string, n: number): string {
  if (n === 1) return word;
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** Formats a quantity: integers as-is, fractions as ½ / ¼ / ¾ where possible. */
export function formatQty(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(rounded);
  const frac = Math.round((rounded - whole) * 100) / 100;
  const fracSym = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  if (frac === 0) return String(whole);
  if (fracSym) return whole === 0 ? fracSym : `${whole}${fracSym}`;
  return String(rounded);
}

export function formatUnits(n: number, baseUnit: string): string {
  return `${formatQty(n)} ${plural(baseUnit, n === 1 ? 1 : 2)}`;
}

export const LEVELS = [
  { label: 'Full', value: 1 },
  { label: '¾', value: 0.75 },
  { label: '½', value: 0.5 },
  { label: 'Low', value: 0.25 },
  { label: 'Empty', value: 0 },
] as const;

export function levelLabel(fraction: number): string {
  if (fraction >= 0.875) return 'Full';
  if (fraction >= 0.625) return '¾';
  if (fraction >= 0.375) return '½';
  if (fraction > 0) return 'Low';
  return 'Empty';
}

/** Number of packages in a sealed lot (lot quantity / units per package). */
export function packCount(lot: StockLot, packages: PackageMap): number {
  return lot.qtyBase / unitsPerPackage(lot.packageId, packages);
}

/** Human description of one lot, e.g. "2 × 6-pack · 12 rolls" or "4 rolls" or "½ bottle". */
/** Whether to show Sealed / Opened for this item's stock. Level tracking needs it (opened → how full). */
export function tracksLotState(item: Item): boolean {
  return item.tracksState || item.tracking === 'level';
}

export function describeLot(lot: StockLot, item: Item, packages: PackageMap): string {
  const pkg = lot.packageId ? packages.get(lot.packageId) : undefined;
  if (lot.state === 'opened') {
    if (item.tracking === 'level' && lot.qtyBase <= 1) {
      return `${levelLabel(lot.qtyBase)} · 1 ${item.baseUnit}`;
    }
    return formatUnits(lot.qtyBase, item.baseUnit);
  }
  if (pkg && unitsPerPackage(pkg.id, packages) > 1) {
    const count = packCount(lot, packages);
    return `${formatQty(count)} × ${pkg.name} · ${formatUnits(lot.qtyBase, item.baseUnit)}`;
  }
  return formatUnits(lot.qtyBase, item.baseUnit);
}

/**
 * Breakdown of all lots by package, e.g. ["1 case", "2 six-packs", "4 loose"].
 * Sealed lots are counted in packages; everything else is loose units.
 */
export function breakdown(lots: StockLot[], item: Item, packages: PackageMap): string[] {
  const counts = new Map<string, number>();
  let loose = 0;
  for (const lot of lots) {
    const pkg = lot.packageId ? packages.get(lot.packageId) : undefined;
    if (lot.state === 'sealed' && pkg && unitsPerPackage(pkg.id, packages) > 1) {
      counts.set(pkg.name, (counts.get(pkg.name) ?? 0) + packCount(lot, packages));
    } else {
      loose += lot.qtyBase;
    }
  }
  const parts = [...counts.entries()].map(([name, n]) => `${formatQty(n)} × ${name}`);
  if (loose > 0 && parts.length > 0) parts.push(`${formatQty(loose)} loose`);
  return parts;
}
