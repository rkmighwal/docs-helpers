import { ANCHOR, addDays, periodStart, remapDate, todayStr } from './dates';

export type Scale = 'week' | 'month' | 'quarter' | 'year';
export type GroupBy = 'auto' | 'none' | 'month' | 'quarter' | 'year';
/** What one cell shows: peak headcount, average FTE over the working days, or person-days of effort. */
export type Measure = 'headcount' | 'fte' | 'days';
export type RowGroup = 'workstream' | 'skill' | 'resource' | 'none';
export type CellMode = 'number' | 'heat' | 'bar' | 'chip' | 'fill';

export const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];

export interface Workstream { id: string; name: string; color: string }
export interface Skill {
  id: string; name: string; color: string;
  /** Standard cost of one person-day. Prices lines with no named resource, and resources without a rate of their own. */
  dayRate?: number;
}
export interface Resource {
  id: string;
  name: string;
  /** The first skill is the primary one: it is the skill the resource's capacity is counted under. */
  skillIds: string[];
  /** Availability, 1 = full time. */
  fte: number;
  workstreamId?: string;
  /** Cost of one person-day of this resource. */
  dayRate?: number;
  /** Optional window in which the resource is available. */
  from?: string;
  to?: string;
  note?: string;
}
export interface Task {
  id: string;
  name: string;
  start: string;
  end: string;
  /** Indent level in the source timeline (0 = phase / top level). */
  level: number;
  kind: 'task' | 'group' | 'milestone';
  workstreamId?: string;
}
/** A load: `count` resources of one skill working in one work stream between two dates. */
export interface Allocation {
  id: string;
  workstreamId: string; // '' = none
  skillId: string; // '' = none
  resourceId?: string; // a named resource, otherwise it is an anonymous demand for `count` people
  /** When set, start and end follow the task. */
  taskId?: string;
  label: string;
  start: string;
  end: string;
  count: number;
  note?: string;
}

export interface Borders { outer: boolean; header: boolean; rows: boolean; cols: boolean; labels: boolean; groups: boolean; total: boolean }
export interface TableStyle {
  borders: Borders;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  zebra: boolean;
  header: 'solid' | 'plain' | 'underline';
  group: 'band' | 'tint' | 'bold' | 'plain';
  cell: CellMode;
  align: 'center' | 'right' | 'left';
  density: 'compact' | 'normal' | 'roomy';
  radius: number;
  showZero: boolean;
  title: 'plain' | 'banner' | 'center';
}
export interface ViewOptions {
  groupBy: RowGroup;
  /**
   * auto: one row per task when the project has tasks, otherwise one row per skill;
   * skills: lines that share a work stream and skill are merged; tasks: one row per task; lines: one row per resource line.
   */
  detail: 'auto' | 'skills' | 'tasks' | 'lines';
  measure: Measure;
  colSkill: boolean;
  colResource: boolean;
  colStart: boolean;
  colEnd: boolean;
  colQty: boolean;
  colTotal: boolean;
  showSubtotals: boolean;
  /** Show the cost rows in the table (only has an effect while cost calculations are switched on). */
  showCost: boolean;
  /** Tasks that have no resource line yet still get a (blank) row, so every imported task is visible. */
  showEmptyTasks: boolean;
  /** A section listing every named resource with their own load, flagged where it exceeds their availability. */
  showResources: boolean;
  showTotal: boolean;
  showCapacity: boolean;
  showGap: boolean;
  showSkillSummary: boolean;
  showWorkingDays: boolean;
  showLegend: boolean;
  showTitle: boolean;
  /** Width of one period column in px; 0 = automatic for the chosen grain. */
  colWidth: number;
  /** Heading of the first column; empty = chosen automatically from the row grouping. */
  nameHeading: string;
  totalLabel: string;
}

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  footerText: string;
  scale: Scale;
  /** Header row above the columns: e.g. months grouped under quarters or years. */
  groupBy: GroupBy;
  startDate: string;
  periods: number;
  /** false = no calendar: columns are Week 1, Week 2… */
  useDates: boolean;
  numbering: 'calendar' | 'relative';
  firstIndex: number;
  savedStartDate?: string;
  /** Days of the week that count as working days, 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  holidayListIds: string[];
  workstreams: Workstream[];
  skills: Skill[];
  resources: Resource[];
  tasks: Task[];
  allocations: Allocation[];
  /** Cost calculations: rates per person-day on resources / skills, priced into the table and a Cost sheet. */
  cost: CostSettings;
  themeId: string;
  templateId: string;
  style: TableStyle;
  view: ViewOptions;
  updatedAt: number;
}

export interface HolidayList { id: string; name: string; holidays: { date: string; name: string }[] }

export interface ThemeColors {
  bg: string; text: string; subtext: string; border: string;
  headerBg: string; headerText: string; groupBg: string; groupText: string; rowAlt: string;
  totalBg: string; totalText: string; accent: string; heatLow: string; heatHigh: string;
  over: string; under: string; title: string;
}
export interface Theme {
  id: string;
  name: string;
  builtin?: boolean;
  colors: ThemeColors;
  fontFamily: string;
  fontSize: number;
}

export const FILE_VERSION = 1;
export const APP_ID = 'resource-loading-planner';

export interface ProjectBundle {
  app: typeof APP_ID;
  version: number;
  project: Project;
  holidayLists: HolidayList[];
  customThemes: Theme[];
}

export function uid(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export interface CostSettings {
  /** Master switch: off hides every cost field and keeps cost out of the table and exports (the rates are kept). */
  enabled: boolean;
  /** Shown in headings, e.g. EUR or $. */
  currency: string;
  /** Working days in one person-month; 0 = automatic (working days per week × 52 ÷ 12). */
  pmDays: number;
  /** Excel export: include the Cost sheet (and the rate column of the Resources sheet). */
  exportSheet: boolean;
  /** Exports: include the cost rows of the table. */
  exportRows: boolean;
}

export const DEFAULT_COST: CostSettings = { enabled: false, currency: 'USD', pmDays: 0, exportSheet: true, exportRows: true };

export function normalizeCost(raw: any): CostSettings {
  const d = DEFAULT_COST;
  return {
    enabled: bool(raw?.enabled, d.enabled),
    currency: typeof raw?.currency === 'string' ? raw.currency.slice(0, 8) : d.currency,
    pmDays: num(raw?.pmDays, 0, 0, 31),
    exportSheet: bool(raw?.exportSheet, d.exportSheet),
    exportRows: bool(raw?.exportRows, d.exportRows),
  };
}

export const DEFAULT_STYLE: TableStyle = {
  borders: { outer: true, header: true, rows: true, cols: true, labels: true, groups: true, total: true },
  borderWidth: 1, borderStyle: 'solid', zebra: false, header: 'solid', group: 'tint', cell: 'number',
  align: 'center', density: 'normal', radius: 0, showZero: false, title: 'plain',
};

export const DEFAULT_VIEW: ViewOptions = {
  groupBy: 'workstream', detail: 'auto', measure: 'headcount',
  colSkill: false, colResource: true, colStart: false, colEnd: false, colQty: false, colTotal: true,
  showSubtotals: true, showCost: true, showEmptyTasks: true, showResources: true, showTotal: true, showCapacity: false, showGap: false, showSkillSummary: false,
  showWorkingDays: false, showLegend: true, showTitle: true, colWidth: 0, nameHeading: '', totalLabel: '',
};

export function newProject(title = 'New project'): Project {
  return {
    id: uid(), title, subtitle: '', footerText: '', scale: 'month', groupBy: 'auto', startDate: periodStart(todayStr(), 'month'), periods: 12,
    useDates: true, numbering: 'calendar', firstIndex: 1, workDays: [1, 2, 3, 4, 5], holidayListIds: [],
    workstreams: [], skills: [], resources: [], tasks: [], allocations: [],
    cost: { ...DEFAULT_COST }, themeId: 'classic', templateId: '', style: clone(DEFAULT_STYLE), view: clone(DEFAULT_VIEW), updatedAt: Date.now(),
  };
}

export function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export const colorAt = (i: number): string => PALETTE[i % PALETTE.length];

/** First palette colour not already used by `used`; cycles once every colour is taken. */
export const nextColor = (used: string[]): string => PALETTE.find(c => !used.some(u => u.toLowerCase() === c)) ?? colorAt(used.length);

export function newWorkstream(p: Project, name = 'Work stream'): Workstream {
  return { id: uid(), name, color: nextColor(p.workstreams.map(w => w.color)) };
}
export function newSkill(p: Project, name = 'Skill'): Skill {
  return { id: uid(), name, color: nextColor(p.skills.map(s => s.color)) };
}
export function newResource(p: Project, name = 'Resource'): Resource {
  return { id: uid(), name, skillIds: p.skills[0] ? [p.skills[0].id] : [], fte: 1 };
}
export function newAllocation(p: Project, start: string, end: string): Allocation {
  return { id: uid(), workstreamId: p.workstreams[0]?.id ?? '', skillId: p.skills[0]?.id ?? '', label: '', start, end, count: 1 };
}

/** A resource's name with their skills — "Alice (Developer, Tester)" — plus their availability when it is not full time. */
export function resourceLabel(r: Pick<Resource, 'name' | 'skillIds' | 'fte'>, skills: Pick<Skill, 'id' | 'name'>[], withFte = false): string {
  const names = r.skillIds.map(id => skills.find(s => s.id === id)?.name).filter(Boolean) as string[];
  const bits = [names.join(', '), withFte && r.fte !== 1 ? `${Math.round(r.fte * 100) / 100} FTE` : ''].filter(Boolean);
  return bits.length ? `${r.name} (${bits.join(' · ')})` : r.name;
}

/** Resources who have a skill (any of theirs, not only the primary one). With no skill given, everyone. */
export const resourcesWithSkill = (p: Pick<Project, 'resources'>, skillId: string): Resource[] => (skillId ? p.resources.filter(r => r.skillIds.includes(skillId)) : p.resources);

/** Dates an allocation really covers: linked allocations follow their task. */
export function allocRange(a: Allocation, p: Pick<Project, 'tasks'>): { start: string; end: string } {
  const t = a.taskId ? p.tasks.find(x => x.id === a.taskId) : undefined;
  return t ? { start: t.start, end: t.end } : { start: a.start, end: a.end < a.start ? a.start : a.end };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: any): v is string => typeof v === 'string' && DATE_RE.test(v);
const hexOr = (v: any, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const pick = <T extends string>(v: any, allowed: readonly T[], d: T): T => (allowed.includes(v) ? v : d);
const num = (v: any, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d);

export function normalizeStyle(raw: any): TableStyle {
  const d = DEFAULT_STYLE, b = raw?.borders ?? {};
  return {
    borders: {
      outer: bool(b.outer, d.borders.outer), header: bool(b.header, d.borders.header), rows: bool(b.rows, d.borders.rows),
      cols: bool(b.cols, d.borders.cols), labels: bool(b.labels, d.borders.labels), groups: bool(b.groups, d.borders.groups), total: bool(b.total, d.borders.total),
    },
    borderWidth: num(raw?.borderWidth, d.borderWidth, 0.5, 4),
    borderStyle: pick(raw?.borderStyle, ['solid', 'dashed', 'dotted'], d.borderStyle),
    zebra: bool(raw?.zebra, d.zebra),
    header: pick(raw?.header, ['solid', 'plain', 'underline'], d.header),
    group: pick(raw?.group, ['band', 'tint', 'bold', 'plain'], d.group),
    cell: pick(raw?.cell, ['number', 'heat', 'bar', 'chip', 'fill'], d.cell),
    align: pick(raw?.align, ['center', 'right', 'left'], d.align),
    density: pick(raw?.density, ['compact', 'normal', 'roomy'], d.density),
    radius: num(raw?.radius, d.radius, 0, 16),
    showZero: bool(raw?.showZero, d.showZero),
    title: pick(raw?.title, ['plain', 'banner', 'center'], d.title),
  };
}

export function normalizeView(raw: any): ViewOptions {
  const d = DEFAULT_VIEW;
  return {
    groupBy: pick(raw?.groupBy, ['workstream', 'skill', 'resource', 'none'], d.groupBy),
    // 'merged' was the only non-line choice before tasks became rows, and the default: it now means automatic
    detail: pick(raw?.detail === 'merged' ? 'auto' : raw?.detail, ['auto', 'skills', 'tasks', 'lines'], d.detail),
    measure: pick(raw?.measure, ['headcount', 'fte', 'days'], d.measure),
    colSkill: bool(raw?.colSkill, d.colSkill), colResource: bool(raw?.colResource, d.colResource),
    colStart: bool(raw?.colStart, d.colStart), colEnd: bool(raw?.colEnd, d.colEnd), colQty: bool(raw?.colQty, d.colQty), colTotal: bool(raw?.colTotal, d.colTotal),
    showSubtotals: bool(raw?.showSubtotals, d.showSubtotals), showCost: bool(raw?.showCost, d.showCost), showEmptyTasks: bool(raw?.showEmptyTasks, d.showEmptyTasks), showResources: bool(raw?.showResources, d.showResources), showTotal: bool(raw?.showTotal, d.showTotal),
    showCapacity: bool(raw?.showCapacity, d.showCapacity), showGap: bool(raw?.showGap, d.showGap),
    showSkillSummary: bool(raw?.showSkillSummary, d.showSkillSummary), showWorkingDays: bool(raw?.showWorkingDays, d.showWorkingDays),
    showLegend: bool(raw?.showLegend, d.showLegend), showTitle: bool(raw?.showTitle, d.showTitle),
    colWidth: num(raw?.colWidth, 0, 0, 400),
    nameHeading: typeof raw?.nameHeading === 'string' && raw.nameHeading !== 'Work stream / skill' ? raw.nameHeading : d.nameHeading, // the old default text is now automatic
    totalLabel: typeof raw?.totalLabel === 'string' ? raw.totalLabel : d.totalLabel,
  };
}

/** A cost per person-day: a positive number, otherwise none. */
const rate = (v: any): number | undefined => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : undefined);
const str = (v: any, d = '') => (typeof v === 'string' ? v : d);
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

/** Fill defaults / repair any parsed JSON into a valid Project. Never throws on bad input. */
export function normalizeProject(raw: any): Project {
  const d = newProject();
  const p: Project = { ...d, id: str(raw?.id) || d.id, title: str(raw?.title, d.title), subtitle: str(raw?.subtitle), footerText: str(raw?.footerText) };
  p.scale = pick(raw?.scale, ['week', 'month', 'quarter', 'year'], d.scale);
  p.groupBy = pick(raw?.groupBy, ['auto', 'none', 'month', 'quarter', 'year'], 'auto');
  p.useDates = bool(raw?.useDates, true);
  p.numbering = pick(raw?.numbering, ['calendar', 'relative'], 'calendar');
  p.firstIndex = num(raw?.firstIndex, 1, 0, 1) >= 0.5 ? 1 : 0;
  p.startDate = isDate(raw?.startDate) ? periodStart(raw.startDate, p.scale) : d.startDate;
  p.savedStartDate = isDate(raw?.savedStartDate) ? raw.savedStartDate : undefined;
  p.periods = Math.floor(num(raw?.periods, 12, 1, 120));
  const wd = arr(raw?.workDays).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  p.workDays = wd.length ? [...new Set(wd)].sort() : [1, 2, 3, 4, 5];
  p.holidayListIds = arr(raw?.holidayListIds).map(String);
  p.workstreams = arr(raw?.workstreams).filter(x => x && typeof x === 'object').map((w, i) => ({ id: str(w.id) || uid(), name: str(w.name, 'Work stream'), color: hexOr(w.color, colorAt(i)) }));
  p.skills = arr(raw?.skills).filter(x => x && typeof x === 'object').map((s, i) => ({ id: str(s.id) || uid(), name: str(s.name, 'Skill'), color: hexOr(s.color, colorAt(i + 3)), dayRate: rate(s.dayRate) }));
  const skillIds = new Set(p.skills.map(s => s.id)), wsIds = new Set(p.workstreams.map(w => w.id));
  p.resources = arr(raw?.resources).filter(x => x && typeof x === 'object').map(r => ({
    id: str(r.id) || uid(), name: str(r.name, 'Resource'), skillIds: arr(r.skillIds).map(String).filter(s => skillIds.has(s)),
    fte: num(r.fte, 1, 0, 10), dayRate: rate(r.dayRate), workstreamId: wsIds.has(r.workstreamId) ? r.workstreamId : undefined,
    from: isDate(r.from) ? r.from : undefined, to: isDate(r.to) ? r.to : undefined, note: str(r.note) || undefined,
  }));
  p.tasks = arr(raw?.tasks).filter(x => x && typeof x === 'object').map(t => {
    const start = isDate(t.start) ? t.start : p.startDate;
    return {
      id: str(t.id) || uid(), name: str(t.name, 'Task'), start, end: isDate(t.end) && t.end >= start ? t.end : start,
      level: Math.floor(num(t.level, 0, 0, 3)), kind: pick(t.kind, ['task', 'group', 'milestone'], 'task'), workstreamId: wsIds.has(t.workstreamId) ? t.workstreamId : undefined,
    };
  });
  const taskIds = new Set(p.tasks.map(t => t.id)), resIds = new Set(p.resources.map(r => r.id));
  p.allocations = arr(raw?.allocations).filter(x => x && typeof x === 'object').map(a => {
    const start = isDate(a.start) ? a.start : p.startDate;
    return {
      id: str(a.id) || uid(), workstreamId: wsIds.has(a.workstreamId) ? a.workstreamId : '', skillId: skillIds.has(a.skillId) ? a.skillId : '',
      resourceId: resIds.has(a.resourceId) ? a.resourceId : undefined, taskId: taskIds.has(a.taskId) ? a.taskId : undefined,
      label: str(a.label), start, end: isDate(a.end) && a.end >= start ? a.end : start, count: num(a.count, 1, 0, 1000), note: str(a.note) || undefined,
    };
  });
  p.cost = normalizeCost(raw?.cost);
  p.themeId = str(raw?.themeId) || d.themeId;
  p.templateId = str(raw?.templateId);
  p.style = normalizeStyle(raw?.style);
  p.view = normalizeView(raw?.view);
  p.updatedAt = Number(raw?.updatedAt) || Date.now();
  return p;
}

/** Convert between calendar and relative mode, keeping every date in the same period. */
export function setUseDates(p: Project, useDates: boolean): void {
  if (p.useDates === useDates) return;
  const from = periodStart(p.startDate, p.scale);
  const to = useDates ? periodStart(p.savedStartDate || todayStr(), p.scale) : ANCHOR;
  const re = (d: string) => remapDate(d, p.scale, from, to);
  p.tasks.forEach(t => { t.start = re(t.start); t.end = re(t.end); });
  p.allocations.forEach(a => { a.start = re(a.start); a.end = re(a.end); });
  p.resources.forEach(r => { if (r.from) r.from = re(r.from); if (r.to) r.to = re(r.to); });
  if (useDates) { p.startDate = to; p.useDates = true; p.numbering = 'calendar'; }
  else { p.savedStartDate = from; p.startDate = ANCHOR; p.useDates = false; p.numbering = 'relative'; }
}

export function sampleProject(): Project {
  const p = newProject('Platform Migration');
  p.subtitle = 'Resource loading plan · FY26';
  const s = p.startDate;
  const ws = (name: string, color: string): Workstream => ({ id: uid(), name, color });
  const sk = (name: string, color: string): Skill => ({ id: uid(), name, color });
  const [be, fe, qa, ops] = [ws('Backend', '#2563eb'), ws('Frontend', '#7c3aed'), ws('QA & Release', '#16a34a'), ws('DevOps', '#ea580c')];
  const [dev, des, tst, devops, pm] = [sk('Developer', '#2563eb'), sk('Designer', '#db2777'), sk('Tester', '#16a34a'), sk('DevOps engineer', '#ea580c'), sk('Project manager', '#475569')];
  p.workstreams = [be, fe, qa, ops];
  p.skills = [dev, des, tst, devops, pm];
  [dev.dayRate, des.dayRate, tst.dayRate, devops.dayRate, pm.dayRate] = [450, 420, 350, 500, 550]; // standard rates; cost calculations are switched off until the user turns them on
  const mo = (n: number) => monthShift(s, n);
  const mk = (w: Workstream, k: Skill, from: number, to: number, count: number, extra: Partial<Allocation> = {}): Allocation =>
    ({ id: uid(), workstreamId: w.id, skillId: k.id, label: '', start: mo(from), end: addDays(mo(to + 1), -1), count, ...extra });
  const person = (name: string, skills: Skill[], fte: number, w?: Workstream): Resource => ({ id: uid(), name, skillIds: skills.map(k => k.id), fte, workstreamId: w?.id });
  const [alice, bob, gus, hana, ivy] = [person('Alice', [dev, tst], 1, be), person('Bob', [dev], 1, be), person('Gus', [dev], 1, fe), person('Hana', [dev], 1, fe), person('Ivy', [dev], 1)];
  const [dana, chen, tom, eli, fay] = [person('Dana', [des], 1, fe), person('Chen', [tst], 0.5, qa), person('Tom', [tst], 1, qa), person('Eli', [devops], 1, ops), person('Fay', [pm], 1)];
  p.resources = [alice, bob, gus, hana, ivy, dana, chen, tom, eli, fay];
  alice.dayRate = 520; // a senior: her own rate wins over the Developer rate
  p.allocations = [
    mk(be, dev, 0, 2, 2), mk(be, dev, 3, 7, 3), mk(be, dev, 8, 9, 1), mk(be, pm, 0, 9, 1, { resourceId: fay.id }),
    mk(fe, des, 0, 3, 1, { resourceId: dana.id }), mk(fe, des, 4, 5, 0.5), mk(fe, dev, 2, 8, 2), mk(fe, dev, 9, 10, 1),
    mk(qa, tst, 4, 6, 1, { resourceId: tom.id }), mk(qa, tst, 7, 9, 1, { resourceId: tom.id }), mk(qa, tst, 7, 9, 0.5, { resourceId: chen.id }), mk(qa, tst, 10, 11, 2),
    mk(ops, devops, 1, 10, 1, { resourceId: eli.id }), mk(ops, devops, 8, 10, 1),
  ];
  p.view.showCapacity = true; p.view.showGap = true; p.view.showSkillSummary = true;
  return p;
}

function monthShift(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
