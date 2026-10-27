import { Allocation, Measure, Project, allocRange } from './model';
import { Axis } from './scale';
import { dayNum, weekdayOf } from './dates';

/** The days covered by the timeline, with the column each one belongs to and whether it is a working day. */
export interface Calendar {
  start: number; // day number of the first day
  days: number;
  cols: number;
  colOf: Int32Array;
  working: Uint8Array;
  /** Working days in each column. */
  colDays: number[];
  totalWorking: number;
}

export function buildCalendar(axis: Axis, workDays: number[], holidays: Iterable<string>): Calendar {
  const start = dayNum(axis.rangeStart), end = dayNum(axis.rangeEnd);
  const days = Math.max(0, end - start), cols = axis.cols.length;
  const colOf = new Int32Array(days), working = new Uint8Array(days);
  const hol = new Set<number>();
  for (const h of holidays) hol.add(dayNum(h));
  const wd = new Set(workDays.length ? workDays : [0, 1, 2, 3, 4, 5, 6]);
  const colDays = new Array<number>(cols).fill(0);
  let totalWorking = 0;
  axis.cols.forEach((c, ci) => {
    const s = dayNum(c.start) - start, e = Math.min(days, dayNum(c.next) - start);
    for (let i = s; i < e; i++) {
      colOf[i] = ci;
      const dn = start + i;
      if (wd.has(weekdayOf(dn)) && !hol.has(dn)) { working[i] = 1; colDays[ci]++; totalWorking++; }
    }
  });
  return { start, days, cols, colOf, working, colDays, totalWorking };
}

/** Add `value` to every working day between two dates (inclusive). */
export function addRange(daily: Float64Array, cal: Calendar, start: string, end: string, value: number): void {
  const s = Math.max(0, dayNum(start) - cal.start), e = Math.min(cal.days - 1, dayNum(end) - cal.start);
  for (let i = s; i <= e; i++) if (cal.working[i]) daily[i] += value;
}

export function dailyLoad(allocs: Allocation[], p: Pick<Project, 'tasks'>, cal: Calendar): Float64Array {
  const d = new Float64Array(cal.days);
  for (const a of allocs) {
    const r = allocRange(a, p);
    addRange(d, cal, r.start, r.end, a.count);
  }
  return d;
}

const r2 = (v: number) => Math.round((v + 1e-9) * 100) / 100;

/** Reduce the per-day load to one number per column, according to the chosen measure. */
export function aggregate(daily: Float64Array, cal: Calendar, measure: Measure): number[] {
  const out = new Array<number>(cal.cols).fill(0);
  for (let i = 0; i < cal.days; i++) {
    if (!cal.working[i]) continue;
    const c = cal.colOf[i], v = daily[i];
    if (measure === 'headcount') { if (v > out[c]) out[c] = v; } else out[c] += v;
  }
  if (measure === 'fte') for (let c = 0; c < cal.cols; c++) out[c] = cal.colDays[c] ? out[c] / cal.colDays[c] : 0;
  return out.map(r2);
}

/** One number for the whole timeline: peak, average or total, matching the measure. */
export function overall(daily: Float64Array, cal: Calendar, measure: Measure): number {
  let peak = 0, sum = 0;
  for (let i = 0; i < cal.days; i++) if (cal.working[i]) { sum += daily[i]; if (daily[i] > peak) peak = daily[i]; }
  return r2(measure === 'headcount' ? peak : measure === 'days' ? sum : cal.totalWorking ? sum / cal.totalWorking : 0);
}

export interface Capacity { total: Float64Array; bySkill: Map<string, Float64Array> }

/** Availability of the named resources, counted under each one's primary skill. */
export function capacityOf(p: Project, cal: Calendar): Capacity {
  const total = new Float64Array(cal.days), bySkill = new Map<string, Float64Array>();
  for (const r of p.resources) {
    if (r.fte <= 0) continue;
    const key = r.skillIds[0] ?? '';
    let arr = bySkill.get(key);
    if (!arr) bySkill.set(key, (arr = new Float64Array(cal.days)));
    const from = r.from || '0001-01-01', to = r.to || '9999-12-31';
    const s = Math.max(0, r.from ? dayNum(from) - cal.start : 0), e = Math.min(cal.days - 1, r.to ? dayNum(to) - cal.start : cal.days - 1);
    for (let i = s; i <= e; i++) if (cal.working[i]) { arr[i] += r.fte; total[i] += r.fte; }
  }
  return { total, bySkill };
}

/** Availability of one named resource per working day (their FTE inside their availability window). */
export function resourceCapacity(r: Project['resources'][number], cal: Calendar): Float64Array {
  const d = new Float64Array(cal.days);
  if (r.fte <= 0) return d;
  const s = Math.max(0, r.from ? dayNum(r.from) - cal.start : 0), e = Math.min(cal.days - 1, r.to ? dayNum(r.to) - cal.start : cal.days - 1);
  for (let i = s; i <= e; i++) if (cal.working[i]) d[i] = r.fte;
  return d;
}

/** Highest load on a named resource relative to their availability (1 = fully used, >1 = over-allocated). */
export function resourceUtilisation(p: Project, cal: Calendar, resourceId: string): { peak: number; overDays: number } {
  const r = p.resources.find(x => x.id === resourceId);
  if (!r) return { peak: 0, overDays: 0 };
  const d = dailyLoad(p.allocations.filter(a => a.resourceId === resourceId), p, cal);
  let peak = 0, overDays = 0;
  const from = r.from ? dayNum(r.from) : -Infinity, to = r.to ? dayNum(r.to) : Infinity;
  for (let i = 0; i < cal.days; i++) {
    if (!cal.working[i] || d[i] === 0) continue;
    const dn = cal.start + i;
    const inWindow = dn >= from && dn <= to;
    const cap = inWindow ? r.fte : 0;
    const u = cap > 0 ? d[i] / cap : Infinity;
    if (u > peak) peak = u;
    if (u > 1 + 1e-9) overDays++;
  }
  return { peak, overDays };
}
