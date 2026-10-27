import type { Scale } from './model';

const DAY = 864e5;
export const parse = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmt = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
export const diffDays = (a: string, b: string): number => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
export const dow = (s: string): number => parse(s).getUTCDay();
/** Whole days since 1970-01-01 (UTC). */
export const dayNum = (s: string): number => Math.round(parse(s).getTime() / DAY);
/** Weekday (0 = Sunday) of a day number from `dayNum`. */
export const weekdayOf = (n: number): number => (((n + 4) % 7) + 7) % 7;
export const todayStr = (): string => {
  const n = new Date();
  return fmt(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
};

export interface CalCtx { weekend: number[]; holidays: Set<string> }

export function isWorkingDay(s: string, ctx: CalCtx): boolean {
  const weekend = ctx.weekend.length >= 7 ? [] : ctx.weekend;
  return !weekend.includes(dow(s)) && !ctx.holidays.has(s);
}

const CAP = 20000;

/** Date of the n-th working day, counting `start` itself if it is a working day. */
export function addWorkingDays(start: string, n: number, ctx: CalCtx): string {
  if (n < 1) return start;
  let cur = start, count = 0;
  for (let i = 0; i < CAP; i++) {
    if (isWorkingDay(cur, ctx)) { count++; if (count === n) return cur; }
    cur = addDays(cur, 1);
  }
  return cur;
}

/** Working days in [start, end] inclusive. */
export function countWorkingDays(start: string, end: string, ctx: CalCtx): number {
  if (end < start) return 0;
  const total = Math.min(diffDays(start, end), CAP);
  let c = 0, cur = start;
  for (let i = 0; i <= total; i++) { if (isWorkingDay(cur, ctx)) c++; cur = addDays(cur, 1); }
  return c;
}

export function periodStart(s: string, scale: Scale): string {
  const d = parse(s);
  switch (scale) {
    case 'week': return addDays(s, -((d.getUTCDay() + 6) % 7)); // Monday
    case 'month': return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    case 'quarter': return fmt(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
    case 'year': return fmt(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
  }
}

export function addPeriods(s: string, scale: Scale, n: number): string {
  const d = parse(s);
  switch (scale) {
    case 'week': return addDays(s, 7 * n);
    case 'month': return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
    case 'quarter': return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * n, 1)));
    case 'year': return fmt(new Date(Date.UTC(d.getUTCFullYear() + n, 0, 1)));
  }
}

export function isoWeek(s: string): number {
  const d = parse(s);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - first.getTime()) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shortDate(s: string): string {
  const d = parse(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Fixed Monday / 1st-of-month / quarter / year start used when a timeline has no calendar dates. */
export const ANCHOR = '2001-01-01';

/** Index (can be negative) of the period containing `d`, counted from the period-aligned `anchor`. */
export function periodIndexOf(d: string, anchor: string, scale: Scale): number {
  const a = parse(anchor), x = parse(d);
  const months = (x.getUTCFullYear() - a.getUTCFullYear()) * 12 + x.getUTCMonth() - a.getUTCMonth();
  switch (scale) {
    case 'week': return Math.floor(diffDays(anchor, d) / 7);
    case 'month': return months;
    case 'quarter': return Math.floor(months / 3);
    case 'year': return x.getUTCFullYear() - a.getUTCFullYear();
  }
}

/** Move a date from one period-aligned origin to another, keeping its period index and offset inside the period. */
export function remapDate(d: string, scale: Scale, from: string, to: string): string {
  const idx = periodIndexOf(d, from, scale);
  const off = diffDays(addPeriods(from, scale, idx), d);
  const ps = addPeriods(to, scale, idx);
  const last = addDays(addPeriods(to, scale, idx + 1), -1);
  // the last day of a period stays the last day, so end dates survive a round trip through months of different lengths
  if (addDays(d, 1) === addPeriods(from, scale, idx + 1)) return last;
  const r = addDays(ps, off);
  return r > last ? last : r;
}
