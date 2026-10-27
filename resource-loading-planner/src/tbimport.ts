import { Allocation, HolidayList, Project, Task, Workstream, nextColor, uid } from './model';
import { ANCHOR, periodStart } from './dates';
import { normalizeHolidayList } from './storage';

/** The parts of a Timeline Builder project this tool reads. */
export interface TbProject {
  title: string;
  subtitle: string;
  scale: Project['scale'];
  groupBy: Project['groupBy'];
  startDate: string;
  periods: number;
  useDates: boolean;
  numbering: Project['numbering'];
  firstIndex: number;
  weekendDays: number[];
  items: TbItem[];
  /** Holiday lists the project uses (looked up from the file's bundle). */
  holidayLists: HolidayList[];
}
export interface TbItem { type: string; name: string; start: string; end: string; level: number }

export interface TbFile { projects: TbProject[] }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: any, d = '') => (typeof v === 'string' ? v : d);

function readProject(raw: any, lists: HolidayList[]): TbProject {
  const scale = ['week', 'month', 'quarter', 'year'].includes(raw?.scale) ? raw.scale : 'month';
  const useDates = raw?.useDates !== false;
  const items: TbItem[] = (Array.isArray(raw?.items) ? raw.items : [])
    .filter((i: any) => i && typeof i === 'object' && DATE_RE.test(i.start))
    .map((i: any) => ({ type: str(i.type, 'task'), name: str(i.name, 'Task'), start: i.start, end: DATE_RE.test(i.end) && i.end >= i.start ? i.end : i.start, level: Math.max(0, Math.floor(Number(i.level) || 0)) }));
  const ids: string[] = Array.isArray(raw?.holidayListIds) ? raw.holidayListIds : [];
  return {
    title: str(raw?.title, 'Imported timeline'), subtitle: str(raw?.subtitle), scale,
    groupBy: ['auto', 'none', 'month', 'quarter', 'year'].includes(raw?.groupBy) ? raw.groupBy : 'auto',
    startDate: DATE_RE.test(raw?.startDate) ? raw.startDate : (items[0]?.start ?? ANCHOR), periods: Math.min(120, Math.max(1, Math.floor(Number(raw?.periods) || 12))),
    useDates, numbering: raw?.numbering === 'relative' ? 'relative' : 'calendar', firstIndex: Number(raw?.firstIndex) === 1 ? 1 : 0,
    weekendDays: Array.isArray(raw?.weekendDays) ? raw.weekendDays.map(Number).filter((n: number) => n >= 0 && n <= 6) : [0, 6],
    items, holidayLists: lists.filter(l => ids.includes(l.id)),
  };
}

/** Reads a Timeline Builder file: a saved project, a backup of all projects, or a bare project. Throws on anything else. */
export function parseTimelineFile(text: string): TbFile {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
  if (j?.app === 'resource-loading-planner') throw new Error('This is a Resource Loading Planner file. Use File ▸ Open / import JSON for those.');
  const lists = (Array.isArray(j?.holidayLists) ? j.holidayLists : []).map(normalizeHolidayList) as HolidayList[];
  let rawProjects: any[] = [];
  if (Array.isArray(j?.projects)) rawProjects = j.projects;
  else if (j?.project && Array.isArray(j.project.items)) rawProjects = [j.project];
  else if (Array.isArray(j?.items)) rawProjects = [j];
  if (!rawProjects.length) throw new Error('This file does not look like a Timeline Builder project.');
  return { projects: rawProjects.map(r => readProject(r, lists)) };
}

export interface ImportOptions {
  /** Bring in the tasks. */
  tasks: boolean;
  /** Also bring in milestones and gates. */
  milestones: boolean;
  /** Create a work stream for each top-level phase and file its tasks under it. */
  workstreamsFromPhases: boolean;
  /** Take over scale, start date, number of columns and working days. */
  applyTimeline: boolean;
  /** Copy the holiday lists the timeline uses. */
  holidays: boolean;
  /** Replace the project's existing tasks instead of adding to them. */
  replace: boolean;
  /** Add one resource line (1 person, no skill yet) per imported task. */
  createLoads: boolean;
}

export const DEFAULT_IMPORT: ImportOptions = { tasks: true, milestones: false, workstreamsFromPhases: true, applyTimeline: true, holidays: true, replace: true, createLoads: true };

export interface ImportSummary { tasks: number; workstreams: number; loads: number; holidayLists: number; timeline: boolean }

/** What an import would bring in, for the confirmation dialog. */
export function describeImport(src: TbProject): { tasks: number; milestones: number; phases: number; holidays: number } {
  return {
    tasks: src.items.filter(i => i.type === 'task' || i.type === 'group').length,
    milestones: src.items.filter(i => i.type === 'milestone' || i.type === 'gate').length,
    phases: src.items.filter(i => i.type === 'group' && i.level === 0).length,
    holidays: src.holidayLists.reduce((n, l) => n + l.holidays.length, 0),
  };
}

/**
 * Apply an import to `p`. Holiday lists must already be in the library; pass the ids of the ones to attach.
 * A timeline whose dated/relative mode differs from the project's is always applied, since its dates would mean nothing otherwise.
 */
export function applyTimelineImport(p: Project, src: TbProject, opts: ImportOptions, attachListIds: string[] = []): ImportSummary {
  const summary: ImportSummary = { tasks: 0, workstreams: 0, loads: 0, holidayLists: attachListIds.length, timeline: false };
  if (opts.applyTimeline || src.useDates !== p.useDates) {
    p.scale = src.scale; p.groupBy = src.groupBy; p.periods = src.periods; p.useDates = src.useDates;
    p.numbering = src.useDates ? src.numbering : 'relative'; p.firstIndex = src.firstIndex;
    p.startDate = src.useDates ? periodStart(src.startDate, src.scale) : ANCHOR;
    p.savedStartDate = undefined;
    const work = [0, 1, 2, 3, 4, 5, 6].filter(d => !src.weekendDays.includes(d));
    p.workDays = work.length ? work : [1, 2, 3, 4, 5];
    summary.timeline = true;
  }
  if (opts.holidays && attachListIds.length) p.holidayListIds = [...new Set([...p.holidayListIds, ...attachListIds])];
  if (!opts.tasks) return summary;

  if (opts.replace) {
    p.allocations.forEach(a => { if (a.taskId) delete a.taskId; });
    p.tasks = [];
  }
  const wsByName = new Map(p.workstreams.map(w => [w.name.trim().toLowerCase(), w]));
  let phase: Workstream | undefined;
  const added: Task[] = [];
  for (const it of src.items) {
    const kind: Task['kind'] | null = it.type === 'task' ? 'task' : it.type === 'group' ? 'group' : (it.type === 'milestone' || it.type === 'gate') && opts.milestones ? 'milestone' : null;
    if (!kind) continue;
    if (kind === 'group' && it.level === 0 && opts.workstreamsFromPhases) {
      const key = it.name.trim().toLowerCase();
      phase = wsByName.get(key);
      if (!phase) {
        phase = { id: uid(), name: it.name.trim() || 'Phase', color: nextColor(p.workstreams.map(w => w.color)) };
        p.workstreams.push(phase); wsByName.set(key, phase); summary.workstreams++;
      }
    }
    const t: Task = { id: uid(), name: it.name, start: it.start, end: it.end, level: Math.min(3, it.level), kind, workstreamId: opts.workstreamsFromPhases ? phase?.id : undefined };
    added.push(t);
  }
  p.tasks.push(...added);
  summary.tasks = added.length;
  if (opts.createLoads) {
    for (const t of added) {
      if (t.kind !== 'task') continue;
      const a: Allocation = { id: uid(), workstreamId: t.workstreamId ?? '', skillId: '', taskId: t.id, label: '', start: t.start, end: t.end, count: 1 };
      p.allocations.push(a); summary.loads++;
    }
  }
  return summary;
}
