/**
 * Autocomplete for manual entry (and the Inventory / "Do we have…?" searches).
 * Ranking: the household's own items → archived items → built-in common items →
 * "Add as new item". Matching is by word start, case-insensitive, with small typo tolerance.
 */
import type { Item } from '@/db/schema';
import { COMMON_ITEMS, type CommonItem } from '@/data/commonItems';

export type Suggestion =
  | { kind: 'own'; item: Item; score: number }
  | { kind: 'archived'; item: Item; score: number }
  | { kind: 'common'; common: CommonItem; score: number }
  | { kind: 'new'; name: string; score: number };

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Scores how well `query` matches `name` (higher is better, 0 = no match).
 * Every query word must match the start of some word in the name; words of 4+ letters
 * may be off by one typo.
 */
export function matchScore(query: string, name: string): number {
  const q = normalize(query).split(/\s+/).filter(Boolean);
  if (q.length === 0) return 0;
  const words = normalize(name).split(/\s+/).filter(Boolean);
  let score = 0;
  for (const qw of q) {
    let best = 0;
    words.forEach((w, idx) => {
      if (w.startsWith(qw)) {
        best = Math.max(best, (idx === 0 ? 3 : 2) + qw.length / Math.max(w.length, 1));
      } else if (qw.length >= 4) {
        const prefix = w.slice(0, qw.length);
        const dist = Math.min(editDistance(qw, prefix), editDistance(qw, w));
        if (dist <= 1) best = Math.max(best, 1);
      }
    });
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

export interface SearchInput {
  query: string;
  items: Item[];
  /** itemId → last activity ISO time, for recency boost. */
  limit?: number;
}

export function suggest({ query, items, limit = 8 }: SearchInput): Suggestion[] {
  const q = query.trim();
  if (!q) return [];
  const out: Suggestion[] = [];
  const nowMs = Date.now();
  const ownNames = new Set<string>();
  for (const item of items) {
    const base = matchScore(q, item.name);
    if (base <= 0) continue;
    ownNames.add(normalize(item.name));
    // Items used recently rise to the top.
    const ageDays = item.lastActivityAt ? (nowMs - Date.parse(item.lastActivityAt)) / 86_400_000 : 365;
    const recency = Math.max(0, 1 - ageDays / 60);
    if (item.archivedAt) out.push({ kind: 'archived', item, score: 100 + base });
    else out.push({ kind: 'own', item, score: 200 + base + recency });
  }
  for (const common of COMMON_ITEMS) {
    if (ownNames.has(normalize(common.name))) continue;
    const base = matchScore(q, common.name);
    if (base > 0) out.push({ kind: 'common', common, score: base });
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.slice(0, limit);
  const exact = top.some((s) => s.kind !== 'new' && normalize(nameOf(s)) === normalize(q));
  if (!exact) top.push({ kind: 'new', name: q, score: 0 });
  return top;
}

export function nameOf(s: Suggestion): string {
  switch (s.kind) {
    case 'own':
    case 'archived':
      return s.item.name;
    case 'common':
      return s.common.name;
    case 'new':
      return s.name;
  }
}

/** Existing items whose names are very close to `name` ("Did you mean…?"). */
export function similarItems(name: string, items: Item[]): Item[] {
  const n = normalize(name);
  if (!n) return [];
  return items.filter((i) => {
    const m = normalize(i.name);
    if (m === n) return true;
    const limit = n.length <= 5 ? 1 : 2;
    return editDistance(n, m) <= limit;
  });
}

/** Filters item summaries for the Inventory search box. */
export function matchesSearch(query: string, name: string): boolean {
  if (!query.trim()) return true;
  return matchScore(query, name) > 0;
}
