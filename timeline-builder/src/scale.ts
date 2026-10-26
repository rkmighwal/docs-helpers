import { Project } from './model';
import { ANCHOR, addPeriods, diffDays, fmt, isoWeek, MONTHS, parse, periodIndexOf, periodStart, shortDate, addDays } from './dates';

export interface Column { start: string; next: string; x: number; w: number; label: string; sub?: string }
export interface HeaderGroup { label: string; x: number; w: number }
export interface Axis {
  cols: Column[]; groups: HeaderGroup[]; width: number; colW: number;
  rangeStart: string; rangeEnd: string; // rangeEnd exclusive
  xOf(date: string): number;
  dateAt(x: number): string;
}

const COL_W = { week: 58, month: 84, quarter: 150, year: 190 } as const;

/** Which grouping levels make sense above each column size. */
export const GROUP_OPTIONS: Record<Project['scale'], Exclude<Project['groupBy'], 'auto'>[]> = {
  week: ['none', 'month', 'quarter', 'year'], month: ['none', 'quarter', 'year'], quarter: ['none', 'year'], year: ['none'],
};

/** Resolved grouping: 'auto' means months/years for dated timelines and none for relative ones. */
export function effectiveGroupBy(p: Project): Exclude<Project['groupBy'], 'auto'> {
  const g = p.groupBy ?? 'auto';
  if (g === 'auto') return !p.useDates ? 'none' : p.scale === 'week' ? 'month' : p.scale === 'year' ? 'none' : 'year';
  return GROUP_OPTIONS[p.scale].includes(g) ? g : 'none';
}

export const UNIT_NAME: Record<Project['scale'], string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

/** Period-aligned origin of the axis (a fixed anchor when the timeline has no calendar dates). */
export const axisStart = (p: Project): string => periodStart(p.useDates ? p.startDate : ANCHOR, p.scale);

export function buildAxis(p: Project): Axis {
  const colW = COL_W[p.scale];
  const first = axisStart(p);
  const relative = !p.useDates || p.numbering === 'relative';
  const num0 = Number.isFinite(p.firstIndex) ? p.firstIndex : 0;
  const cols: Column[] = [];
  for (let i = 0; i < p.periods; i++) {
    const start = addPeriods(first, p.scale, i);
    const next = addPeriods(first, p.scale, i + 1);
    const d = parse(start);
    const y = d.getUTCFullYear();
    let label = '', sub: string | undefined;
    switch (p.scale) {
      case 'week': label = `W${isoWeek(start)}`; sub = shortDate(start); break;
      case 'month': label = MONTHS[d.getUTCMonth()]; break;
      case 'quarter': label = `Q${Math.floor(d.getUTCMonth() / 3) + 1}`; break;
      case 'year': label = String(y); break;
    }
    if (relative) { label = `${UNIT_NAME[p.scale]} ${num0 + i}`; }
    if (!p.useDates) sub = undefined;
    cols.push({ start, next, x: i * colW, w: colW, label, sub });
  }
  const groupBy = effectiveGroupBy(p);
  const groups: HeaderGroup[] = [];
  if (groupBy !== 'none') {
    for (const c of cols) {
      const ref = parse(p.scale === 'week' ? addDays(c.start, 3) : c.start); // a week belongs to the month/quarter of its Thursday
      const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
      const refStr = fmt(ref);
      let key: number, label: string;
      if (groupBy === 'year') {
        key = y; label = p.useDates ? String(y) : `Year ${periodIndexOf(refStr, first, 'year') + num0}`;
      } else if (groupBy === 'quarter') {
        key = y * 4 + Math.floor(m / 3);
        label = p.useDates ? `Q${Math.floor(m / 3) + 1} ${y}` : `Quarter ${periodIndexOf(refStr, ANCHOR, 'quarter') + num0}`;
      } else {
        key = y * 12 + m;
        label = p.useDates ? `${MONTHS[m]} ${y}` : `Month ${periodIndexOf(refStr, ANCHOR, 'month') + num0}`;
      }
      const last = groups[groups.length - 1] as (HeaderGroup & { key?: number }) | undefined;
      if (last && last.key === key) last.w += c.w;
      else groups.push({ label, x: c.x, w: c.w, key } as HeaderGroup);
    }
  }
  const rangeStart = cols[0].start;
  const rangeEnd = cols[cols.length - 1].next;
  const width = cols.length * colW;

  const xOf = (date: string): number => {
    if (date <= rangeStart) return 0;
    if (date >= rangeEnd) return width;
    // columns are equal width; locate by linear scan (periods <= 120)
    for (const c of cols) {
      if (date >= c.start && date < c.next) return c.x + c.w * diffDays(c.start, date) / diffDays(c.start, c.next);
    }
    return width;
  };
  const dateAt = (x: number): string => {
    const cx = Math.min(width - 1e-6, Math.max(0, x));
    const c = cols[Math.floor(cx / colW)];
    const frac = (cx - c.x) / c.w;
    return addDays(c.start, Math.floor(frac * diffDays(c.start, c.next)));
  };
  return { cols, groups, width, colW, rangeStart, rangeEnd, xOf, dateAt };
}
