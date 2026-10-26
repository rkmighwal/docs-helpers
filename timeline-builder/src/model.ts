import { CalCtx, addWorkingDays, countWorkingDays, todayStr, addDays, periodStart, remapDate, ANCHOR } from './dates';
import type { ShapeId } from './shapes';

export type Scale = 'week' | 'month' | 'quarter' | 'year';
export type ItemType = 'task' | 'group' | 'milestone' | 'gate' | 'holiday' | 'note';
export type GroupBy = 'auto' | 'none' | 'month' | 'quarter' | 'year';
export type LegendPos = 'bottom' | 'top' | 'right';
export type BarStyle = 'solid' | 'outline' | 'gradient' | 'striped' | 'shadow';
export type GroupStyle = 'bracket' | 'bar' | 'line' | 'heading';
export type HeaderStyle = 'solid' | 'underline' | 'rounded' | 'plain';

export const ITEM_TYPES: { type: ItemType; label: string }[] = [
  { type: 'task', label: 'Task' },
  { type: 'group', label: 'Phase / Group' },
  { type: 'milestone', label: 'Milestone' },
  { type: 'gate', label: 'Gate / Check-point' },
  { type: 'holiday', label: 'Holiday / Freeze band' },
  { type: 'note', label: 'Note' },
];

export interface Item {
  id: string;
  type: ItemType;
  name: string;
  start: string;
  end: string;
  workingDays: number;
  durationMode: 'end' | 'days';
  progress: number; // 0-100, tasks only
  level: number; // indent 0..3
  color?: string;
  /** Marker shape (milestone/gate/note) or small icon beside the name (other types). */
  icon?: ShapeId;
  /** Per-item bar look; falls back to the theme's. */
  barStyle?: BarStyle;
  /** Wording shown for this item's look in the legend. */
  legendLabel?: string;
}

export interface LegendCfg {
  show: boolean;
  position: LegendPos;
  custom: { label: string; color: string; icon?: ShapeId }[];
}

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  scale: Scale;
  /** Header row above the columns: e.g. months grouped under quarters or years. */
  groupBy: GroupBy;
  startDate: string;
  periods: number;
  weekendDays: number[]; // 0=Sun..6=Sat
  holidayListIds: string[];
  themeId: string;
  items: Item[];
  legend: LegendCfg;
  showDates: boolean;
  showToday: boolean;
  showWeekends: boolean;
  showHolidays: boolean;
  /** false = no calendar: columns are Week 0, Week 1… and items are placed by period number. */
  useDates: boolean;
  /** 'relative' labels columns Week 0, 1, 2… even when dates are used. */
  numbering: 'calendar' | 'relative';
  /** Number of the first column in relative numbering (0 or 1). */
  firstIndex: number;
  /** Text for the footer (e.g. a website or confidentiality note). */
  footerText: string;
  /** Relative mode: number of the current period, highlighted by themes that support it. */
  currentPeriod?: number;
  /** Calendar start remembered while the timeline is in relative mode. */
  savedStartDate?: string;
  updatedAt: number;
}

export interface HolidayList {
  id: string;
  name: string;
  holidays: { date: string; name: string }[];
}

export interface Theme {
  id: string;
  name: string;
  builtin?: boolean;
  colors: {
    bg: string; text: string; subtext: string; grid: string; headerBg: string; headerText: string;
    headerBg2: string; rowAlt: string; weekend: string; holiday: string; today: string;
    task: string; group: string; milestone: string; gate: string; holidayBand: string; note: string;
    legendBg: string; border: string;
  };
  fontFamily: string;
  rowHeight: number;
  barHeight: number; // percent of row
  barRadius: number;
  gridStyle: 'solid' | 'dashed' | 'none';
  zebra: boolean;
  design: ThemeDesign;
}

export interface ThemeDesign {
  header: HeaderStyle;
  bar: BarStyle;
  group: GroupStyle;
  milestone: ShapeId;
  gate: ShapeId;
  note: ShapeId;
  /** Title block: plain text, full-width banner (title left, subtitle right) or centred. */
  title: 'plain' | 'banner' | 'center' | 'split';
  /** Page decoration: coloured footer band, thin top/bottom bands, or rules above/below the chart. */
  frame: 'none' | 'footer-band' | 'thin-bands' | 'rules' | 'rule';
  /** Row look: ruled grid, rounded bands (chart only / full width), or a thin line through each row. */
  rows: 'grid' | 'bands' | 'bands-full' | 'line' | 'itemline' | 'pillcols';
  /** How task progress is shown. */
  progress: 'overlay' | 'percent' | 'status' | 'none';
  /** 'side' removes phase rows and draws a vertical pill beside the rows of each phase. */
  groupLabel: 'row' | 'side';
  /** Bars fill whole grid cells (dashed sub-grid). */
  cells: boolean;
  legend: 'inline' | 'boxes';
  labelHeading: string;
  /** Colour used to highlight the current period column ('' = off). */
  highlight: string;
  titleColor: string;
  subtitleColor: string;
  /** Colour for tasks at 100% ('' = none). */
  doneColor: string;
  /** End colour of gradient bars ('' = lighter shade of the bar colour). */
  gradientTo: string;
  /** [done, in progress, not started] colours for tasks without their own colour (empty = off). */
  statusColors: string[];
  /** Colours cycled across header groups (e.g. quarters). */
  headerPalette: string[];
}

export const FILE_VERSION = 1;

export interface ProjectBundle {
  app: 'timeline-builder';
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

export function newItem(type: ItemType, start: string, name?: string): Item {
  const it: Item = {
    id: uid(), type, name: name ?? ITEM_TYPES.find(t => t.type === type)!.label,
    start, end: start, workingDays: type === 'task' || type === 'group' ? 5 : 1,
    durationMode: type === 'task' || type === 'group' ? 'days' : 'end',
    progress: 0, level: 0,
  };
  return it;
}

export function newProject(title = 'New project'): Project {
  const start = periodStart(todayStr(), 'month');
  return {
    id: uid(), title, subtitle: '', scale: 'month', groupBy: 'auto', startDate: start, periods: 12,
    weekendDays: [0, 6], holidayListIds: [], themeId: 'corporate', items: [],
    legend: { show: true, position: 'bottom', custom: [] },
    showDates: false, showToday: true, showWeekends: true, showHolidays: true,
    useDates: true, numbering: 'calendar', firstIndex: 0, footerText: '',
    updatedAt: Date.now(),
  };
}

const isPoint = (t: ItemType) => t === 'milestone' || t === 'gate' || t === 'note';

/** Recompute end date / working days of an item from whichever field is authoritative. */
export function recalcItem(it: Item, ctx: CalCtx): void {
  if (isPoint(it.type)) { it.end = it.start; it.workingDays = 0; it.durationMode = 'end'; return; }
  if (it.type === 'holiday') {
    if (it.end < it.start) it.end = it.start;
    it.durationMode = 'end';
    it.workingDays = countWorkingDays(it.start, it.end, ctx);
    return;
  }
  if (it.durationMode === 'days') {
    it.workingDays = Math.max(1, Math.floor(Number(it.workingDays) || 1));
    it.end = addWorkingDays(it.start, it.workingDays, ctx);
  } else {
    if (!it.end || it.end < it.start) it.end = it.start;
    it.workingDays = countWorkingDays(it.start, it.end, ctx);
  }
}

/** Fill defaults / migrate any parsed JSON into a valid Project. */
export function normalizeProject(raw: any): Project {
  const d = newProject();
  const p: Project = { ...d, ...(raw ?? {}) };
  p.legend = { ...d.legend, ...(raw?.legend ?? {}) };
  p.legend.custom = Array.isArray(p.legend.custom) ? p.legend.custom : [];
  p.weekendDays = Array.isArray(p.weekendDays) ? p.weekendDays : [0, 6];
  p.holidayListIds = Array.isArray(p.holidayListIds) ? p.holidayListIds : [];
  p.periods = Math.min(120, Math.max(1, Math.floor(Number(p.periods) || 12)));
  if (!['auto', 'none', 'month', 'quarter', 'year'].includes(p.groupBy)) p.groupBy = 'auto';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) p.startDate = d.startDate;
  p.items = (Array.isArray(raw?.items) ? raw.items : []).map((i: any) => {
    const t: ItemType = ITEM_TYPES.some(x => x.type === i?.type) ? i.type : 'task';
    const base = newItem(t, /^\d{4}-\d{2}-\d{2}$/.test(i?.start) ? i.start : p.startDate);
    return { ...base, ...i, type: t, level: Math.min(3, Math.max(0, Number(i?.level) || 0)) } as Item;
  });
  return p;
}

/** Convert between calendar and relative mode, keeping every item in the same period. */
export function setUseDates(p: Project, useDates: boolean): void {
  if (p.useDates === useDates) return;
  const from = periodStart(p.startDate, p.scale);
  if (useDates) {
    const to = periodStart(p.savedStartDate || todayStr(), p.scale);
    p.items.forEach(i => { i.start = remapDate(i.start, p.scale, from, to); i.end = remapDate(i.end, p.scale, from, to); });
    p.startDate = to; p.useDates = true; p.numbering = 'calendar';
  } else {
    p.savedStartDate = from;
    p.items.forEach(i => { i.start = remapDate(i.start, p.scale, from, ANCHOR); i.end = remapDate(i.end, p.scale, from, ANCHOR); });
    p.startDate = ANCHOR; p.useDates = false; p.numbering = 'relative';
  }
}

export function sampleProject(): Project {
  const p = newProject('Website Relaunch');
  p.subtitle = 'Delivery plan · FY26';
  const s = p.startDate;
  const mk = (type: ItemType, name: string, off: number, days: number, level = 0, extra: Partial<Item> = {}) => {
    const it = newItem(type, addDays(s, off), name);
    it.workingDays = days; it.level = level; Object.assign(it, extra);
    return it;
  };
  p.items = [
    mk('group', 'Discovery', 0, 20),
    mk('task', 'Stakeholder interviews', 0, 8, 1, { progress: 100 }),
    mk('task', 'Requirements & scope', 10, 10, 1, { progress: 100 }),
    mk('gate', 'Scope sign-off', 28, 1),
    mk('group', 'Design', 31, 30),
    mk('task', 'UX wireframes', 31, 15, 1, { progress: 60 }),
    mk('task', 'Visual design', 47, 15, 1, { progress: 20 }),
    mk('group', 'Build', 62, 60),
    mk('task', 'Front-end', 62, 40, 1),
    mk('task', 'Back-end & CMS', 70, 40, 1),
    mk('holiday', 'Year-end freeze', 110, 1, 0, { end: addDays(s, 118), durationMode: 'end' }),
    mk('milestone', 'Go-live', 150, 1),
  ];
  return p;
}
