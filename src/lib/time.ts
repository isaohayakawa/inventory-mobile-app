/** Clock helpers. Tests can pin "now" with setNow(). Dates are local 'YYYY-MM-DD'. */
let fixedNow: Date | null = null;

export function setNow(d: Date | null) {
  fixedNow = d;
}

export function now(): Date {
  return fixedNow ? new Date(fixedNow.getTime()) : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toDateString(now());
}

/** Parses 'YYYY-MM-DD' as a local date at midnight. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/** Whole days from today until dateStr (negative = in the past). */
export function daysUntil(dateStr: string): number {
  const ms = parseDate(dateStr).getTime() - parseDate(today()).getTime();
  return Math.round(ms / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatShortDate(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateString(parseDate(s)) === s;
}

/** 'HH:MM' → minutes after midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function isValidTime(t: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h < 24 && m < 60;
}

export function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/** True when the local time of `d` falls inside quiet hours (which may wrap midnight). */
export function isInQuietHours(d: Date, quietStart: string, quietEnd: string): boolean {
  const mins = d.getHours() * 60 + d.getMinutes();
  const s = timeToMinutes(quietStart);
  const e = timeToMinutes(quietEnd);
  if (s === e) return false;
  return s < e ? mins >= s && mins < e : mins >= s || mins < e;
}

/** The next moment at or after `from` that is outside quiet hours. */
export function nextAllowedTime(from: Date, quietStart: string, quietEnd: string): Date {
  if (!isInQuietHours(from, quietStart, quietEnd)) return from;
  const e = timeToMinutes(quietEnd);
  const d = new Date(from.getTime());
  d.setHours(Math.floor(e / 60), e % 60, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** Next occurrence of local time 'HH:MM' strictly after `from`. */
export function nextOccurrence(from: Date, time: string): Date {
  const mins = timeToMinutes(time);
  const d = new Date(from.getTime());
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

export function relativeDay(iso: string): string {
  const days = -daysUntil(toDateString(new Date(iso)));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatShortDate(toDateString(new Date(iso)));
}
