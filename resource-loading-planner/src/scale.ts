import { Project } from './model';
import { ANCHOR, addDays, addPeriods, diffDays, fmt, isoWeek, MONTHS, parse, periodIndexOf, periodStart, shortDate } from './dates';

export interface Column { start: string; next: string; x: number; w: number; label: string; sub?: string }
export interface HeaderGroup { label: string; x: number; w: number }
export interface Axis {
  cols: Column[]; groups: HeaderGroup[]; width: number; colW: number;
  rangeStart: string; rangeEnd: string; // rangeEnd exclusive
}

export const DEFAULT_COL_W = { week: 46, month: 62, quarter: 88, year: 104 } as const;

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
  const colW = p.view.colWidth > 0 ? p.view.colWidth : DEFAULT_COL_W[p.scale];
  const first = axisStart(p);
  const relative = !p.useDates || p.numbering === 'relative';
  const num0 = Number.isFinite(p.firstIndex) ? p.firstIndex : 1;
  const cols: Column[] = [];
  for (let i = 0; i < p.periods; i++) {
    const start = addPeriods(first, p.scale, i);
    const next = addPeriods(first, p.scale, i + 1);
    const d = parse(start);
    let label = '', sub: string | undefined;
    switch (p.scale) {
      case 'week': label = `W${isoWeek(start)}`; sub = shortDate(start); break;
      case 'month': label = MONTHS[d.getUTCMonth()]; break;
      case 'quarter': label = `Q${Math.floor(d.getUTCMonth() / 3) + 1}`; break;
      case 'year': label = String(d.getUTCFullYear()); break;
    }
    if (relative) label = `${p.scale === 'week' ? 'W' : p.scale === 'month' ? 'M' : p.scale === 'quarter' ? 'Q' : 'Y'}${num0 + i}`;
    if (!p.useDates) sub = undefined;
    cols.push({ start, next, x: i * colW, w: colW, label, sub });
  }
  const groupBy = effectiveGroupBy(p);
  const groups: HeaderGroup[] = [];
  if (groupBy !== 'none') {
    let lastKey = NaN;
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
      if (groups.length && key === lastKey) groups[groups.length - 1].w += c.w;
      else groups.push({ label, x: c.x, w: c.w });
      lastKey = key;
    }
  }
  const rangeStart = cols[0].start;
  const rangeEnd = cols[cols.length - 1].next;
  return { cols, groups, width: cols.length * colW, colW, rangeStart, rangeEnd };
}

/** Number of days from range start to range end (exclusive). */
export const rangeDays = (a: Axis): number => diffDays(a.rangeStart, a.rangeEnd);
