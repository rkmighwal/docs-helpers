import { Allocation, Measure, Project, allocRange, resourceLabel } from './model';
import { Axis, UNIT_NAME, axisStart, buildAxis } from './scale';
import { Calendar, aggregate, buildCalendar, capacityOf, dailyLoad, overall, resourceCapacity } from './calc';
import { MONTHS, dayNum, parse, periodIndexOf } from './dates';
import { costActive, costDaily, costSummary, fmtMoneyFull, rateOf } from './cost';

export type RowKind = 'group' | 'row' | 'person' | 'total' | 'capacity' | 'gap' | 'section' | 'skill' | 'cost' | 'costtotal';

/** Rows that show one thing's own load (a line, task or person), as opposed to sums, capacity and headings. */
export const isLeafKind = (k: RowKind): boolean => k === 'row' || k === 'person';

export interface TRow {
  id: string;
  kind: RowKind;
  label: string;
  /** 0 = top level, 1 = indented under a group. */
  level: 0 | 1;
  /** Accent colour of the row (work stream colour where known); '' = none. */
  color: string;
  skill: string;
  resource: string;
  start: string;
  end: string;
  qty: string;
  values: number[];
  /** Peak / average / total over the whole timeline, depending on the measure. */
  total: number | null;
  /** Available capacity per column; a value above it is flagged as over-allocated. */
  limit?: number[];
  /** Allocations this row sums up (used to jump from the preview to the editor). */
  allocIds: string[];
  /** The values are amounts of money (cost rows). */
  money?: boolean;
  /** The working behind a figure, for its hover text: a column index, or null for the total column. */
  explain?: (col: number | null) => string;
}

export interface LabelCol { id: 'name' | 'skill' | 'resource' | 'start' | 'end' | 'qty'; title: string; align: 'left' | 'center' }

export interface TableModel {
  rows: TRow[];
  labelCols: LabelCol[];
  axis: Axis;
  cal: Calendar;
  measure: Measure;
  measureLabel: string;
  totalTitle: string;
  /** Largest value per row kind, used to scale heat maps and bars. */
  max: Record<'leaf' | 'agg', number>;
  empty: boolean;
  /** Present when the table includes cost rows. */
  cost?: { currency: string; pmDays: number; pmAuto: boolean; unpriced: number };
}

export const labelCell = (col: LabelCol, r: TRow): string => (col.id === 'name' ? r.label : r[col.id]);

export const MEASURES: { id: Measure; label: string; short: string; help: string }[] = [
  { id: 'headcount', label: 'Headcount (peak)', short: 'Peak', help: 'The most people loaded at the same time in the period' },
  { id: 'fte', label: 'Average FTE', short: 'Avg', help: 'People loaded, averaged over the working days of the period' },
  { id: 'days', label: 'Person-days', short: 'Days', help: 'Total effort in the period: people × working days' },
];

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round((v + 1e-9) * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

export function fmtDate(p: Project, iso: string): string {
  if (!p.useDates) {
    const idx = periodIndexOf(iso, axisStart(p), p.scale) + p.firstIndex;
    return `${UNIT_NAME[p.scale]} ${idx}`;
  }
  const d = parse(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

const NO_COLOR = '#94a3b8';

/** Most people loaded at once across these allocations, counting their whole date range (not just the visible columns). */
export function peakConcurrent(list: Allocation[], p: Pick<Project, 'tasks'>): number {
  const ev: [number, number][] = [];
  for (const a of list) { const r = allocRange(a, p); ev.push([dayNum(r.start), a.count], [dayNum(r.end) + 1, -a.count]); }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // on a shared day, ends are processed before starts
  let cur = 0, peak = 0;
  for (const [, d] of ev) { cur += d; if (cur > peak) peak = cur; }
  return Math.round(peak * 100) / 100;
}

export interface TableOptions {
  /** Include the cost rows (default: yes, when cost calculations are on and shown). Exports pass false to leave cost out. */
  cost?: boolean;
}

export function buildTable(p: Project, holidays: Iterable<string> = [], o: TableOptions = {}): TableModel {
  const v = p.view;
  const axis = buildAxis(p);
  const cal = buildCalendar(axis, p.workDays, p.useDates ? holidays : []);
  const measure = v.measure;
  const mdef = MEASURES.find(m => m.id === measure)!;
  const agg = (d: Float64Array) => aggregate(d, cal, measure);
  const ws = new Map(p.workstreams.map((w, i) => [w.id, { ...w, order: i }]));
  const sk = new Map(p.skills.map((s, i) => [s.id, { ...s, order: i }]));
  const rs = new Map(p.resources.map((r, i) => [r.id, { ...r, order: i }]));
  const wsName = (id: string) => ws.get(id)?.name ?? 'No work stream';
  const skName = (id: string) => sk.get(id)?.name ?? 'No skill';
  // wherever a resource is named in the table, their skills come with the name
  const rsName = (id?: string) => { const r = id ? rs.get(id) : undefined; return r ? resourceLabel(r, p.skills) : ''; };
  const colorOf = (a: Allocation) => ws.get(a.workstreamId)?.color ?? sk.get(a.skillId)?.color ?? NO_COLOR;
  const allocs = p.allocations;

  // ---- tasks as rows ----
  const taskAt = new Map(p.tasks.map((t, i) => [t.id, { ...t, order: i }]));
  // automatic: as soon as there are tasks (imported or added), they are the rows; "Tasks without resources" decides whether unloaded ones are listed
  const tasksMode = v.detail === 'tasks' || (v.detail === 'auto' && (allocs.some(a => a.taskId && taskAt.has(a.taskId)) || (v.showEmptyTasks && p.tasks.some(t => t.kind === 'task'))));
  const linkedTasks = new Set(allocs.map(a => a.taskId).filter(Boolean));
  // a task nobody is loaded onto yet still gets its row (a zero-load stand-in that is never saved), so an import shows every task
  const standIns: Allocation[] = tasksMode && v.showEmptyTasks
    ? p.tasks.filter(t => t.kind === 'task' && !linkedTasks.has(t.id)).map(t => ({ id: `task:${t.id}`, workstreamId: t.workstreamId ?? '', skillId: '', taskId: t.id, label: '', start: t.start, end: t.end, count: 0 }))
    : [];
  const rowAllocs = [...allocs, ...standIns];
  const linesPerTask = new Map<string, number>();
  for (const a of allocs) if (a.taskId) linesPerTask.set(a.taskId, (linesPerTask.get(a.taskId) ?? 0) + 1);

  const autoHeading = v.groupBy === 'workstream' ? `Work stream / ${tasksMode ? 'task' : v.detail === 'lines' ? 'line' : 'skill'}`
    : v.groupBy === 'skill' ? `Skill / ${tasksMode ? 'task' : 'work stream'}`
      : v.groupBy === 'resource' ? `Resource / ${tasksMode ? 'task' : 'work stream'}`
        : tasksMode ? 'Task' : v.detail === 'lines' ? 'Line' : 'Work stream · skill';
  const labelCols: LabelCol[] = [{ id: 'name', title: v.nameHeading || autoHeading, align: 'left' }];
  if (v.colSkill) labelCols.push({ id: 'skill', title: 'Skill', align: 'left' });
  // the Resource column only appears once somebody is actually assigned, so it is never an empty column
  if (v.colResource && allocs.some(a => a.resourceId)) labelCols.push({ id: 'resource', title: 'Resource', align: 'left' });
  if (v.colStart) labelCols.push({ id: 'start', title: 'Start', align: 'center' });
  if (v.colEnd) labelCols.push({ id: 'end', title: 'End', align: 'center' });
  if (v.colQty) labelCols.push({ id: 'qty', title: 'Qty', align: 'center' });

  const rows: TRow[] = [];
  const blank = (): Pick<TRow, 'skill' | 'resource' | 'start' | 'end' | 'qty'> => ({ skill: '', resource: '', start: '', end: '', qty: '' });
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].join(', ');
  const leaf = (id: string, label: string, list: Allocation[], level: 0 | 1, color: string): TRow => {
    const d = dailyLoad(list, p, cal);
    const ranges = list.map(a => allocRange(a, p));
    return {
      id, kind: 'row', label, level, color,
      skill: uniq(list.map(a => skName(a.skillId))), resource: uniq(list.map(a => rsName(a.resourceId))),
      start: ranges.length ? fmtDate(p, ranges.reduce((m, r) => (r.start < m ? r.start : m), ranges[0].start)) : '',
      end: ranges.length ? fmtDate(p, ranges.reduce((m, r) => (r.end > m ? r.end : m), ranges[0].end)) : '',
      qty: list.every(a => a.count === 0) ? '' : fmtNum(peakConcurrent(list, p)), values: agg(d), total: overall(d, cal, measure), allocIds: list.map(a => a.id),
    };
  };

  // ---- grouping keys ----
  type Key = { key: string; label: string; order: number; color: string };
  const groupKey = (a: Allocation): Key => {
    switch (v.groupBy) {
      case 'workstream': return { key: a.workstreamId, label: wsName(a.workstreamId), order: ws.get(a.workstreamId)?.order ?? 1e6, color: ws.get(a.workstreamId)?.color ?? NO_COLOR };
      case 'skill': return { key: a.skillId, label: skName(a.skillId), order: sk.get(a.skillId)?.order ?? 1e6, color: sk.get(a.skillId)?.color ?? NO_COLOR };
      case 'resource': return { key: a.resourceId ?? '', label: a.resourceId ? rsName(a.resourceId) : 'Unassigned (by skill)', order: a.resourceId ? rs.get(a.resourceId)?.order ?? 1e6 : 1e7, color: '' };
      default: return { key: '', label: '', order: 0, color: '' };
    }
  };
  const childKey = (a: Allocation): Key => {
    const w = { key: a.workstreamId, label: wsName(a.workstreamId), order: ws.get(a.workstreamId)?.order ?? 1e6, color: colorOf(a) };
    const s = { key: a.skillId, label: skName(a.skillId), order: (sk.get(a.skillId)?.order ?? 1e6) + 1e5, color: colorOf(a) }; // after the task rows
    const task = tasksMode && a.taskId ? taskAt.get(a.taskId) : undefined;
    if (task) return { key: `t:${task.id}`, label: task.name, order: task.order, color: colorOf(a) };
    switch (v.groupBy) {
      case 'workstream': return s;
      case 'skill': case 'resource': return w;
      default: return { key: `${a.workstreamId}|${a.skillId}`, label: a.workstreamId ? `${w.label} · ${s.label}` : s.label, order: w.order * 1000 + s.order, color: w.color };
    }
  };
  const lineLabel = (a: Allocation): string => {
    const task = a.taskId ? taskAt.get(a.taskId)?.name : '';
    // several lines on one task would all read the same, so say what each one is
    if (!a.label && task && (linesPerTask.get(a.taskId!) ?? 0) > 1) return `${task} · ${rsName(a.resourceId) || skName(a.skillId)}`;
    return a.label || task || rsName(a.resourceId) || skName(a.skillId);
  };

  const buckets = new Map<string, { key: Key; list: Allocation[] }>();
  for (const a of rowAllocs) {
    const k = groupKey(a);
    const b = buckets.get(k.key) ?? { key: k, list: [] };
    b.list.push(a); buckets.set(k.key, b);
  }
  const groups = [...buckets.values()].sort((a, b) => a.key.order - b.key.order);

  for (const g of groups) {
    const flat = v.groupBy === 'none';
    if (!flat) {
      const d = dailyLoad(g.list, p, cal);
      rows.push({
        id: `g:${g.key.key}`, kind: 'group', label: g.key.label, level: 0, color: g.key.color, ...blank(),
        values: v.showSubtotals ? agg(d) : [], total: v.showSubtotals ? overall(d, cal, measure) : null, allocIds: g.list.map(a => a.id),
      });
    }
    const lvl: 0 | 1 = flat ? 0 : 1;
    if (v.detail === 'lines') {
      for (const a of g.list) rows.push(leaf(`a:${a.id}`, lineLabel(a), [a], lvl, colorOf(a)));
    } else {
      const kids = new Map<string, { key: Key; list: Allocation[] }>();
      for (const a of g.list) {
        const k = childKey(a);
        const b = kids.get(k.key) ?? { key: k, list: [] };
        b.list.push(a); kids.set(k.key, b);
      }
      for (const c of [...kids.values()].sort((a, b) => a.key.order - b.key.order)) rows.push(leaf(`c:${g.key.key}:${c.key.key}`, c.key.label, c.list, lvl, c.key.color));
    }
  }

  // ---- totals, capacity, skill summary ----
  const all = dailyLoad(allocs, p, cal);
  const cap = capacityOf(p, cal);
  const hasCap = p.resources.some(r => r.fte > 0);
  const capVals = agg(cap.total);
  const loaded = agg(all);
  const totalLabel = v.totalLabel || (measure === 'headcount' ? 'Total resources loaded' : measure === 'fte' ? 'Total FTE loaded' : 'Total person-days');
  if (v.showTotal) {
    rows.push({ id: 'total', kind: 'total', label: totalLabel, level: 0, color: '', ...blank(), values: loaded, total: overall(all, cal, measure), limit: v.showCapacity && hasCap ? capVals : undefined, allocIds: [] });
  }
  if (v.showCapacity && hasCap) {
    rows.push({ id: 'capacity', kind: 'capacity', label: 'Available capacity', level: 0, color: '', ...blank(), values: capVals, total: overall(cap.total, cal, measure), allocIds: [] });
    if (v.showGap) {
      rows.push({ id: 'gap', kind: 'gap', label: 'Spare (+) / shortfall (−)', level: 0, color: '', ...blank(), values: capVals.map((c, i) => Math.round((c - loaded[i] + 1e-9) * 100) / 100), total: null, allocIds: [] });
    }
  }
  // "Loading by skill" is the section; named resources are an option inside it. Each resource is counted under its primary skill, so it is listed there.
  const nestPeople = v.showResources && p.resources.length > 0 && v.groupBy !== 'resource';
  if (v.showSkillSummary) {
    const used = new Map<string, Allocation[]>();
    for (const a of allocs) (used.get(a.skillId) ?? used.set(a.skillId, []).get(a.skillId)!).push(a);
    for (const s of p.skills) if (cap.bySkill.has(s.id) && !used.has(s.id)) used.set(s.id, []);
    if (nestPeople) for (const r of p.resources) if (!used.has(r.skillIds[0] ?? '')) used.set(r.skillIds[0] ?? '', []); // people with nothing booked yet still show
    const ids = [...used.keys()].sort((a, b) => (sk.get(a)?.order ?? 1e6) - (sk.get(b)?.order ?? 1e6));
    if (ids.length) {
      rows.push({ id: 'sec:skills', kind: 'section', label: 'Loading by skill', level: 0, color: '', ...blank(), values: [], total: null, allocIds: [] });
      for (const id of ids) {
        const d = dailyLoad(used.get(id)!, p, cal);
        const c = cap.bySkill.get(id);
        const color = sk.get(id)?.color ?? NO_COLOR;
        rows.push({ id: `sk:${id}`, kind: 'skill', label: skName(id), level: 0, color, ...blank(), values: agg(d), total: overall(d, cal, measure), limit: v.showCapacity && c ? agg(c) : undefined, allocIds: used.get(id)!.map(a => a.id) });
        if (v.showCapacity && c) rows.push({ id: `skc:${id}`, kind: 'capacity', label: 'available', level: 1, color, ...blank(), values: agg(c), total: overall(c, cal, measure), allocIds: [] });
        if (nestPeople) {
          for (const r of p.resources) {
            if ((r.skillIds[0] ?? '') !== id) continue;
            const list = allocs.filter(a => a.resourceId === r.id); // all of the person's work, whichever skill each line is booked under
            const dr = dailyLoad(list, p, cal);
            rows.push({
              id: `rs:${r.id}`, kind: 'person', label: resourceLabel(r, p.skills, true), level: 1, color, ...blank(),
              skill: r.skillIds.map(skName).join(', '), values: agg(dr), total: overall(dr, cal, measure),
              limit: agg(resourceCapacity(r, cal)), // a person's own availability is always checked, whether or not the capacity rows are shown
              allocIds: list.map(a => a.id),
            });
          }
        }
      }
    }
  }

  // ---- cost ----
  let costInfo: TableModel['cost'];
  if ((o.cost ?? true) && costActive(p) && v.showCost) {
    const sum = costSummary(p, cal);
    costInfo = { currency: p.cost.currency, pmDays: sum.pmDays, pmAuto: sum.pmAuto, unpriced: sum.unpriced };
    rows.push({ id: 'sec:cost', kind: 'section', label: `Cost${p.cost.currency ? ` (${p.cost.currency})` : ''}`, level: 0, color: '', ...blank(), values: [], total: null, allocIds: [] });
    // one row per group; with no grouping, per work stream
    const costBuckets = new Map<string, { key: Key; list: Allocation[] }>();
    for (const a of allocs) {
      const k = v.groupBy === 'none' ? { key: a.workstreamId, label: wsName(a.workstreamId), order: ws.get(a.workstreamId)?.order ?? 1e6, color: ws.get(a.workstreamId)?.color ?? NO_COLOR } : groupKey(a);
      const b = costBuckets.get(k.key) ?? { key: k, list: [] };
      b.list.push(a); costBuckets.set(k.key, b);
    }
    // ---- the working behind each figure (shown when hovering it) ----
    const cur = p.cost.currency;
    const money = (x: number) => fmtMoneyFull(x, cur);
    const personDays = new Map<string, number[]>(); // per allocation: person-days in every column
    const daysOf = (a: Allocation): number[] => {
      let x = personDays.get(a.id);
      if (!x) personDays.set(a.id, (x = aggregate(dailyLoad([a], p, cal), cal, 'days')));
      return x;
    };
    const periodTitle = (col: number | null): string => {
      if (col === null) return 'the whole timeline';
      const c = axis.cols[col], year = parse(c.start).getUTCFullYear();
      if (!p.useDates) return c.label;
      return p.scale === 'year' ? c.label : p.scale === 'week' ? `${c.label} (week of ${c.sub} ${year})` : `${c.label} ${year}`;
    };
    const lineWho = (a: Allocation): string => {
      const who = a.resourceId ? rs.get(a.resourceId)?.name : '';
      const task = a.taskId ? taskAt.get(a.taskId)?.name : '';
      return `${skName(a.skillId)}${who ? ` (${who})` : ''}${task ? ` · ${task}` : ''}`;
    };
    /** "Developer (Alice): 3 × 22 days × $450 = $29,700" for one line in one column (or the whole timeline). */
    const calcLine = (a: Allocation, col: number | null): { text: string; cost: number } | null => {
      const arr = daysOf(a);
      const days = col === null ? arr.reduce((n, x) => n + x, 0) : arr[col] ?? 0;
      if (!(days > 0)) return null;
      const { rate, source } = rateOf(a, p);
      const each = a.count > 0 ? Math.round((days / a.count + 1e-9) * 100) / 100 : 0;
      const head = `${lineWho(a)}: ${fmtNum(a.count)} × ${fmtNum(each)} day${each === 1 ? '' : 's'}`;
      return rate
        ? { text: `${head} × ${money(rate)} = ${money(days * rate)}${source === 'resource' ? ' (resource rate)' : ' (skill rate)'}`, cost: days * rate }
        : { text: `${head} — no rate, not priced`, cost: 0 };
    };
    const MAX_LINES = 14;
    const listing = (list: Allocation[], col: number | null): string[] => {
      const lines = list.map(a => calcLine(a, col)).filter(Boolean) as { text: string; cost: number }[];
      return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES).map(l => l.text), `… and ${lines.length - MAX_LINES} more lines`] : lines.map(l => l.text);
    };
    const explainGroup = (label: string, list: Allocation[], values: number[], total: number) => (col: number | null): string => {
      const shown = col === null ? total : values[col] ?? 0;
      const lines = listing(list, col);
      return [`${label} · ${periodTitle(col)}`, 'cost = people × working days × cost per person-day', ...(lines.length ? lines : ['nothing is loaded']), `Total: ${money(shown)}`].join('\n');
    };

    const groupRows: TRow[] = [];
    for (const b of [...costBuckets.values()].sort((x, y) => x.key.order - y.key.order)) {
      const d = costDaily(b.list, p, cal);
      const values = aggregate(d, cal, 'days'), total = overall(d, cal, 'days');
      const row: TRow = { id: `cost:${b.key.key}`, kind: 'cost', label: b.key.label, level: 0, color: b.key.color, ...blank(), values, total, allocIds: b.list.map(a => a.id), money: true, explain: explainGroup(b.key.label, b.list, values, total) };
      groupRows.push(row); rows.push(row);
    }
    const dAll = costDaily(allocs, p, cal);
    const allValues = aggregate(dAll, cal, 'days'), allTotal = overall(dAll, cal, 'days');
    rows.push({
      id: 'cost:total', kind: 'costtotal', label: 'Total cost', level: 0, color: '', ...blank(), values: allValues, total: allTotal, allocIds: [], money: true,
      explain: (col: number | null) => [`Total cost · ${periodTitle(col)}`, ...groupRows.filter(g => (col === null ? g.total ?? 0 : g.values[col] ?? 0) !== 0).map(g => `${g.label}: ${money(col === null ? g.total ?? 0 : g.values[col] ?? 0)}`), `Total: ${money(col === null ? allTotal : allValues[col] ?? 0)}`,
        ...(sum.unpriced ? [`${sum.unpriced} resource line${sum.unpriced === 1 ? ' has' : 's have'} no rate and ${sum.unpriced === 1 ? 'is' : 'are'} not included`] : [])].join('\n'),
    });
    const pm = sum.pmDays;
    const daysAll = aggregate(all, cal, 'days');
    const effort = daysAll.map(x => (pm > 0 ? Math.round((x / pm + 1e-9) * 100) / 100 : 0));
    rows.push({
      id: 'cost:effort', kind: 'cost', label: 'Effort (person-months)', level: 0, color: '', ...blank(), values: effort, total: sum.personMonths, allocIds: [],
      explain: (col: number | null) => {
        const d = col === null ? sum.totalPersonDays : daysAll[col] ?? 0;
        return [`Effort · ${periodTitle(col)}`, `${fmtNum(d)} person-days ÷ ${fmtNum(pm)} working days per person-month`, `= ${fmtNum(pm > 0 ? d / pm : 0)} person-month${pm > 0 && Math.abs(d / pm - 1) < 0.005 ? '' : 's'}`, sum.pmAuto ? '(person-month length is automatic — change it under Cost)' : '(person-month length set under Cost)'].join('\n');
      },
    });

  }

  const max = { leaf: 0, agg: 0 };
  for (const r of rows) {
    const m = isLeafKind(r.kind) ? 'leaf' : r.kind === 'group' || r.kind === 'total' || r.kind === 'skill' ? 'agg' : null;
    if (m) for (const x of r.values) if (x > max[m]) max[m] = x;
  }
  if (!max.leaf) max.leaf = 1;
  if (!max.agg) max.agg = 1;
  return { rows, labelCols, axis, cal, measure, measureLabel: mdef.label, totalTitle: mdef.short, max, empty: rowAllocs.length === 0, cost: costInfo };
}
