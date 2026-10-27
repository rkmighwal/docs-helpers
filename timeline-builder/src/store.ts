import { CalCtx } from './dates';
import { HolidayList, Look, Project, Theme, newProject, recalcItem, uid } from './model';
import { Library, loadLibrary, saveLibrary } from './storage';
import { BUILTIN_THEMES, lookOf } from './themes';
import type { Holiday } from './render';

export type SaveStatus = 'saved' | 'saving' | 'error';
type Listener = (structural: boolean) => void;

class Store {
  lib: Library = loadLibrary();
  private listeners: Listener[] = [];
  private statusListeners: ((s: SaveStatus) => void)[] = [];
  private saveTimer: number | undefined;
  private undoStack: Record<string, string[]> = {};
  private redoStack: Record<string, string[]> = {};
  private lastKey = '';
  private lastKeyAt = 0;

  constructor() {
    this.lib.projects.forEach(p => this.recalcAll(p));
    window.addEventListener('beforeunload', () => this.flush());
  }

  subscribe(fn: Listener) { this.listeners.push(fn); }
  onStatus(fn: (s: SaveStatus) => void) { this.statusListeners.push(fn); }

  active(): Project { return this.lib.projects.find(p => p.id === this.lib.activeId)!; }

  holidayListsFor(p: Project): HolidayList[] { return !p.useDates ? [] : this.lib.holidayLists.filter(l => p.holidayListIds.includes(l.id)); }
  holidaysFor(p: Project): Holiday[] {
    const map = new Map<string, Holiday>();
    for (const l of this.holidayListsFor(p)) for (const h of l.holidays) if (!map.has(h.date)) map.set(h.date, h);
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  ctxFor(p: Project): CalCtx {
    return { weekend: p.weekendDays, holidays: new Set(this.holidaysFor(p).map(h => h.date)) };
  }
  allThemes(): Theme[] { return [...BUILTIN_THEMES, ...this.lib.customThemes]; }
  themeFor(p: Project): Theme { return this.allThemes().find(t => t.id === p.themeId) ?? BUILTIN_THEMES[0]; }
  /** The project's theme and layout together. */
  lookFor(p: Project): Look { return lookOf(p, this.themeFor(p)); }

  recalcAll(p: Project) {
    const ctx = this.ctxFor(p);
    p.items.forEach(i => recalcItem(i, ctx));
  }

  private emit(structural: boolean) {
    this.listeners.forEach(l => l(structural));
    this.scheduleSave();
  }

  private pushUndo(key?: string) {
    const p = this.active();
    const now = Date.now();
    if (key && key === this.lastKey && now - this.lastKeyAt < 1000) { this.lastKeyAt = now; return; }
    this.lastKey = key ?? ''; this.lastKeyAt = now;
    (this.undoStack[p.id] ||= []).push(JSON.stringify(p));
    if (this.undoStack[p.id].length > 100) this.undoStack[p.id].shift();
    this.redoStack[p.id] = [];
  }
  breakCoalesce() { this.lastKey = ''; }

  mutate(fn: (p: Project) => void, structural = false, key?: string) {
    this.pushUndo(key);
    const p = this.active();
    fn(p);
    this.recalcAll(p);
    p.updatedAt = Date.now();
    this.emit(structural);
  }

  /** Re-render the editor without changing the project, e.g. to put back a control the user changed to an invalid value. */
  refresh() { this.emit(true); }

  canUndo() { return (this.undoStack[this.lib.activeId]?.length ?? 0) > 0; }
  canRedo() { return (this.redoStack[this.lib.activeId]?.length ?? 0) > 0; }
  private swap(from: Record<string, string[]>, to: Record<string, string[]>) {
    const id = this.lib.activeId;
    const snap = from[id]?.pop();
    if (!snap) return;
    (to[id] ||= []).push(JSON.stringify(this.active()));
    const idx = this.lib.projects.findIndex(p => p.id === id);
    this.lib.projects[idx] = JSON.parse(snap);
    this.lastKey = '';
    this.emit(true);
  }
  undo() { this.swap(this.undoStack, this.redoStack); }
  redo() { this.swap(this.redoStack, this.undoStack); }

  setActive(id: string) {
    if (this.lib.projects.some(p => p.id === id)) { this.lib.activeId = id; this.lastKey = ''; this.emit(true); }
  }
  addProject(p: Project = newProject()) {
    this.recalcAll(p);
    this.lib.projects.push(p);
    this.setActive(p.id);
  }
  duplicateActive() {
    const copy: Project = JSON.parse(JSON.stringify(this.active()));
    copy.id = uid(); copy.title += ' (copy)';
    copy.items.forEach(i => (i.id = uid()));
    this.addProject(copy);
  }
  removeProject(id: string) {
    this.lib.projects = this.lib.projects.filter(p => p.id !== id);
    if (!this.lib.projects.length) this.lib.projects.push(newProject());
    if (this.lib.activeId === id) this.lib.activeId = this.lib.projects[0].id;
    delete this.undoStack[id]; delete this.redoStack[id];
    this.emit(true);
  }
  moveProject(id: string, dir: -1 | 1) {
    const i = this.lib.projects.findIndex(p => p.id === id), j = i + dir;
    if (j < 0 || j >= this.lib.projects.length) return;
    [this.lib.projects[i], this.lib.projects[j]] = [this.lib.projects[j], this.lib.projects[i]];
    this.emit(true);
  }

  /** Upsert a holiday list; recalculates every project that uses it. */
  upsertHolidayList(l: HolidayList) {
    const i = this.lib.holidayLists.findIndex(x => x.id === l.id);
    if (i >= 0) this.lib.holidayLists[i] = l; else this.lib.holidayLists.push(l);
    this.lib.projects.forEach(p => this.recalcAll(p));
    this.emit(true);
  }
  removeHolidayList(id: string) {
    this.lib.holidayLists = this.lib.holidayLists.filter(l => l.id !== id);
    this.lib.projects.forEach(p => { p.holidayListIds = p.holidayListIds.filter(x => x !== id); this.recalcAll(p); });
    this.emit(true);
  }
  upsertTheme(t: Theme) {
    const i = this.lib.customThemes.findIndex(x => x.id === t.id);
    if (i >= 0) this.lib.customThemes[i] = t; else this.lib.customThemes.push(t);
    this.emit(true);
  }
  removeTheme(id: string) {
    this.lib.customThemes = this.lib.customThemes.filter(t => t.id !== id);
    this.lib.projects.forEach(p => { if (p.themeId === id) p.themeId = BUILTIN_THEMES[0].id; });
    this.emit(true);
  }
  replaceLibrary(lib: Library) {
    this.lib = lib;
    this.lib.projects.forEach(p => this.recalcAll(p));
    this.undoStack = {}; this.redoStack = {};
    this.emit(true);
  }

  private scheduleSave() {
    this.statusListeners.forEach(f => f('saving'));
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 300);
  }
  flush() {
    window.clearTimeout(this.saveTimer);
    const ok = saveLibrary(this.lib);
    this.statusListeners.forEach(f => f(ok ? 'saved' : 'error'));
  }
}

export const store = new Store();
