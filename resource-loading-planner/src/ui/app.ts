import { h, pickFile, toast } from './dom';
import { markTourDone, startTour, tourPending } from './tour';
import { plannerTour } from '../tourSteps';
import { openCostExportDialog, openHolidayDialog, openLicenseDialog, openTemplateDialog, openThemeDialog, openTimelineImportDialog } from './dialogs';
import { APP, formatReleaseDate } from '../about';
import { store } from '../store';
import { Allocation, CellMode, GroupBy, Measure, Project, Resource, RowGroup, Scale, Skill, Task, Workstream, allocRange, newAllocation, nextColor, resourceLabel, resourcesWithSkill, setUseDates, uid } from '../model';
import { renderPlan, RenderResult } from '../render';
import { DOW, addDays, addPeriods, periodIndexOf, periodStart, fmt, isoWeek, parse, MONTHS } from '../dates';
import { DEFAULT_COL_W, GROUP_OPTIONS, UNIT_NAME, axisStart, buildAxis, effectiveGroupBy } from '../scale';
import { buildCalendar, resourceUtilisation } from '../calc';
import { MEASURES, fmtNum } from '../table';
import { TEMPLATES } from '../templates';
import { CURRENCIES, costActive, costSummary, currencyOf, fmtMoneyFull, fmtPlain, isKnownCurrency, pmDaysAuto, pmDaysOf } from '../cost';
import { download, makeBundle, mergeImport, parseImport, readFileText, saveJsonFile, slug, svgToPng } from '../export';
import { exportXlsx } from '../excel';

const DEFAULT_PERIODS: Record<Scale, number> = { week: 12, month: 12, quarter: 8, year: 5 };
const GROUP_LABEL: Record<string, string> = { none: 'No grouping', month: 'Months', quarter: 'Quarters', year: 'Years' };
const ROW_GROUP_LABEL: Record<RowGroup, string> = { workstream: 'Work stream', skill: 'Skill', resource: 'Resource', none: 'No grouping' };
const CELL_LABEL: Record<CellMode, string> = { number: 'Numbers only', heat: 'Heat map (shaded by load)', bar: 'In-cell bars', chip: 'Coloured chips', fill: 'Filled cells (Gantt style)' };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ---- remembered UI state (open sections, collapsed panes) ---- */
interface UiState { open: Record<string, boolean>; sidebar: boolean; editor: boolean; /** Show the “hover a cost figure” tip above the preview. */ costTip: boolean }
const UI_KEY = 'resource-loading-planner:ui';
const UI_DEFAULT: UiState = { open: { project: true, timeline: true, loading: true }, sidebar: true, editor: true, costTip: true };
const ui: UiState = (() => {
  try { const j = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); return { ...UI_DEFAULT, ...j, open: { ...UI_DEFAULT.open, ...(j.open ?? {}) } }; } catch { return { ...UI_DEFAULT, open: { ...UI_DEFAULT.open } }; }
})();
const TOUR_KEY = 'resource-loading-planner:tour';
/** While the guided tour opens and folds sections, what the user has open is left alone. */
let touring = false;
const saveUi = () => { if (touring) return; try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ } };

const CARDS = ['project', 'timeline', 'workstreams', 'skills', 'resources', 'tasks', 'loading', 'cost', 'content', 'look'];

export function mountApp(root: HTMLElement) {
  let layout: RenderResult | null = null;
  let zoom = 1;
  let pendingFocus = '';
  let fittedFor = '';
  const openRows = new Set<string>();
  const P = () => store.active();

  const top = h('header', { class: 'top' });
  const side = h('aside', { class: 'side' });
  const editor = h('section', { class: 'editor' });
  const preview = h('div', { class: 'preview-scroll' });
  const zoomLabel = h('span', { class: 'zoom-label' }, '100%');
  const zoomRange = h('input', { type: 'range', min: 20, max: 200, value: 100, oninput: (e: Event) => setZoom(Number((e.target as HTMLInputElement).value) / 100) }) as HTMLInputElement;
  const setZoom = (z: number) => {
    zoom = Math.min(2, Math.max(0.2, z));
    zoomRange.value = String(Math.round(zoom * 100)); zoomLabel.textContent = `${Math.round(zoom * 100)}%`; applyZoom();
  };
  const applyLayoutClasses = () => {
    document.body.classList.toggle('hide-side', !ui.sidebar);
    document.body.classList.toggle('hide-editor', !ui.editor);
  };
  const FOOT = 'Click a row to jump to its resource line · hover a cell for details';
  const COST_FOOT = 'Click a row to jump to its resource line · hover a cell for details — hover a cost figure to see how it is calculated';
  const previewFoot = h('div', { class: 'preview-foot' }, FOOT);
  const costTip = h('div', { class: 'cost-tip' },
    h('span', {}, '💡 ', h('strong', {}, 'Hover any cost figure'), ' in the table to see how it is calculated: the lines behind it, people × working days × the rate, and the total.'),
    h('button', { class: 'linkbtn', onclick: () => { ui.costTip = false; saveUi(); costTip.hidden = true; } }, 'Got it'));
  costTip.hidden = true;
  const previewPane = h('section', { class: 'preview' },
    h('div', { class: 'preview-bar' },
      h('button', { class: 'btn small', title: 'Show / hide the editor to give the preview more room', onclick: () => { ui.editor = !ui.editor; saveUi(); applyLayoutClasses(); } }, '◧ Editor'),
      h('strong', {}, 'Preview'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => setZoom((preview.clientWidth - 40) / (layout?.width || 1)) }, 'Fit width'),
      h('button', { class: 'btn small', onclick: () => setZoom(1) }, '100%'),
      zoomRange, zoomLabel),
    costTip,
    preview,
    previewFoot);
  const foot = h('footer', { class: 'appfoot' },
    h('span', {}, `${APP.name} v${APP.version}`),
    h('span', { class: 'dot' }, '·'), h('span', {}, `Published ${formatReleaseDate(APP.releaseDate)}`),
    h('span', { class: 'dot' }, '·'),
    h('button', { class: 'linkbtn', title: 'Read the license', onclick: openLicenseDialog }, `${APP.licenseId} License`));
  root.append(top, h('div', { class: 'body' }, side, editor, previewPane), foot);

  /* ---------------- helpers ---------------- */
  const field = (label: string, input: HTMLElement | HTMLElement[], hint?: string) =>
    h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), input, hint && h('small', { class: 'fhint' }, hint));
  const select = (value: string, options: [string, string][], onChange: (v: string) => void, cls = '') =>
    h('select', { class: cls, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  const checkbox = (label: string, checked: boolean, on: (v: boolean) => void, title?: string, disabled = false) =>
    h('label', { class: 'check' + (disabled ? ' off' : ''), title }, h('input', { type: 'checkbox', checked, disabled, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);
  const num = (value: number | string, min: number, max: number, step: number, on: (n: number) => void, cls = '', disabled = false) =>
    h('input', { type: 'number', class: cls, min, max, step, value, disabled, onchange: (e: Event) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) on(Math.min(max, Math.max(min, n))); } });
  const set = <K extends keyof Project>(key: K, value: Project[K], structural = true) => store.mutate(q => { q[key] = value; }, structural);

  function card(id: string, title: string, hint: string, body: (HTMLElement | false | undefined)[], step?: number) {
    const d = h('details', { class: 'card', 'data-card': id, open: ui.open[id] ?? false },
      h('summary', {}, step ? h('span', { class: 'step' }, String(step)) : null, h('span', { class: 'card-title' }, title), h('span', { class: 'card-hint' }, hint)),
      h('div', { class: 'card-body' }, ...(body.filter(Boolean) as HTMLElement[])));
    d.addEventListener('toggle', () => { ui.open[id] = d.open; saveUi(); });
    return d;
  }
  function menu(label: string, entries: ([string, () => void] | null)[], primary = false) {
    const d = h('details', { class: 'menu' },
      h('summary', { class: 'btn' + (primary ? ' primary' : '') }, label + ' ▾'),
      h('div', { class: 'menu-list' }, ...entries.map(e => e ? h('button', { class: 'menu-item', onclick: () => { d.open = false; e[1](); } }, e[0]) : h('hr'))));
    return d;
  }
  document.addEventListener('click', e => document.querySelectorAll('details.menu[open]').forEach(m => { if (!m.contains(e.target as Node)) (m as HTMLDetailsElement).open = false; }));

  const nameOf = (list: { id: string; name: string }[], id?: string, none = '—') => list.find(x => x.id === id)?.name ?? none;
  const opts = (list: { id: string; name: string }[], none: string): [string, string][] => [['', none], ...list.map(x => [x.id, x.name] as [string, string])];

  /* ---- dates: real dates, or period numbers when the timeline has no calendar ---- */
  function dateInput(p: Project, iso: string | undefined, kind: 'start' | 'end', apply: (iso: string | undefined) => void, o: { disabled?: boolean; optional?: boolean; title?: string } = {}) {
    if (p.useDates) {
      return h('input', { type: 'date', value: iso ?? '', disabled: o.disabled, title: o.title ?? (kind === 'start' ? 'First day' : 'Last day (inclusive)'),
        onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) apply(v); else if (o.optional) apply(undefined); } });
    }
    const origin = axisStart(p), n0 = p.firstIndex, unit = UNIT_NAME[p.scale].toLowerCase();
    return h('input', { type: 'number', class: 'pnum', value: iso ? periodIndexOf(iso, origin, p.scale) + n0 : '', disabled: o.disabled, placeholder: o.optional ? 'any' : '',
      title: o.title ?? (kind === 'start' ? `First ${unit} number` : `Last ${unit} number (inclusive)`),
      onchange: (e: Event) => {
        const raw = (e.target as HTMLInputElement).value;
        if (raw === '') { if (o.optional) apply(undefined); return; }
        const n = Math.round(Number(raw)); if (!Number.isFinite(n)) return;
        apply(kind === 'start' ? addPeriods(origin, p.scale, n - n0) : addDays(addPeriods(origin, p.scale, n - n0 + 1), -1));
      } });
  }
  const timelineEnd = (p: Project) => addDays(buildAxis(p).rangeEnd, -1);

  /* ---------------- actions ---------------- */
  const doImport = async () => {
    const f = await pickFile('.json,application/json'); if (!f) return;
    try {
      const added = mergeImport(store.lib, parseImport(await readFileText(f)));
      store.replaceLibrary(store.lib); store.setActive(added[0].id);
      toast(`Imported ${added.length} project${added.length > 1 ? 's' : ''}`);
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const doSaveJson = async () => {
    const p = P();
    const r = await saveJsonFile(`${slug(p.title)}.loading.json`, JSON.stringify(makeBundle(p, store.lib), null, 2));
    if (r !== 'cancelled') toast(r === 'saved' ? 'Saved to file' : 'Project JSON downloaded');
  };
  const doBackup = async () => {
    const r = await saveJsonFile('resource-loading-planner-backup.json', JSON.stringify({ app: 'resource-loading-planner', version: 1, ...store.lib }, null, 2));
    if (r !== 'cancelled') toast('Backup of all projects saved');
  };
  const currentSvg = (cost: boolean) => renderPlan(P(), store.themeFor(P()), store.holidayDates(P()), { interactive: false, cost });
  /** When cost is in use, ask what of it goes into this export; otherwise just go. */
  const withCost = (kind: 'xlsx' | 'image', go: (r: { sheet: boolean; rows: boolean }) => void) => {
    const p = P();
    if (!costActive(p)) return go({ sheet: false, rows: false });
    if (kind === 'image' && !p.view.showCost) return go({ sheet: false, rows: false }); // no cost in the picture, nothing to ask
    openCostExportDialog({ title: kind === 'xlsx' ? 'Export to Excel' : 'Export image', sheet: kind === 'xlsx', rows: p.view.showCost }, go);
  };
  const doSvg = () => withCost('image', ({ rows }) => { download(`${slug(P().title)}.svg`, currentSvg(rows).svg, 'image/svg+xml'); });
  const doPng = (scale: number) => withCost('image', async ({ rows }) => {
    try {
      const r = currentSvg(rows);
      const cap = Math.min(scale, 16000 / Math.max(r.width, r.height));
      if (cap < scale) toast(`Image is large, exported at ${Math.max(1, Math.floor(cap * 10) / 10)}× instead`);
      download(`${slug(P().title)}.png`, await svgToPng(r.svg, r.width, r.height, Math.max(0.25, cap)), 'image/png');
    } catch (e: any) { toast(e.message, 'error'); }
  });
  const doXlsx = () => withCost('xlsx', ({ sheet, rows }) => {
    try {
      const p = P();
      download(`${slug(p.title)}.xlsx`, exportXlsx(p, store.themeFor(p), store.holidayListsFor(p), { costSheet: sheet, costRows: rows }), XLSX_TYPE);
      toast('Excel workbook downloaded');
    } catch (e: any) { toast('Excel export failed: ' + e.message, 'error'); }
  });

  /* ---------------- top bar ---------------- */
  const statusEl = h('span', { class: 'status' }, '✓ Auto-saved in browser');
  const undoBtn = h('button', { class: 'btn', title: 'Undo (Ctrl/Cmd+Z)', onclick: () => store.undo() }, '↶');
  const redoBtn = h('button', { class: 'btn', title: 'Redo (Ctrl/Cmd+Shift+Z)', onclick: () => store.redo() }, '↷');
  top.append(
    h('button', { class: 'btn', title: 'Show / hide project list', onclick: () => { ui.sidebar = !ui.sidebar; saveUi(); applyLayoutClasses(); } }, '☰'),
    h('h1', {}, 'Resource Loading Planner'),
    menu('File', [
      ['New project', () => store.addProject()], ['Duplicate project', () => store.duplicateActive()], null,
      ['Open / import project JSON…', doImport], ['Save project as JSON…', doSaveJson], ['Backup all projects…', doBackup], null,
      ['Import tasks & timeline from Timeline Builder…', openTimelineImportDialog], null,
      [`About & ${APP.licenseId} license…`, openLicenseDialog]]),
    menu('Export', [
      ['Excel workbook (.xlsx)', doXlsx], null,
      ['SVG — vector, best for slides', doSvg], null,
      ['PNG — standard (2×)', () => doPng(2)], ['PNG — high resolution (4×)', () => doPng(4)], ['PNG — small (1×)', () => doPng(1)]], true),
    h('button', { class: 'btn', title: 'Start from a ready-made table design', onclick: openTemplateDialog, 'data-tour': 'templates' }, '▦ Templates'),
    h('button', { class: 'btn', title: 'Colours and fonts', onclick: openThemeDialog, 'data-tour': 'themes' }, '🎨 Themes'),
    h('button', { class: 'btn', onclick: openHolidayDialog, 'data-tour': 'holidays' }, '🗓 Holiday lists'),
    h('button', { class: 'btn', title: 'A one-minute guided tour of the tool', onclick: () => runTour(), 'data-tour': 'tour' }, '❓ Quick tour'),
    undoBtn, redoBtn, h('span', { class: 'spacer' }), statusEl);
  store.onStatus(s => {
    statusEl.textContent = s === 'saved' ? '✓ Auto-saved in browser' : s === 'saving' ? 'Saving…' : '⚠ Browser storage unavailable — use File ▸ Save project';
    statusEl.className = 'status ' + s;
  });

  /* ---------------- sidebar ---------------- */
  function renderSide() {
    side.replaceChildren(
      h('div', { class: 'side-head' }, 'Projects'),
      ...store.lib.projects.map(p => h('div', { class: 'proj' + (p.id === store.lib.activeId ? ' active' : ''), onclick: () => store.setActive(p.id) },
        h('div', { class: 'proj-title' }, p.title || 'Untitled'),
        h('small', {}, `${p.useDates ? '' : 'relative · '}${p.scale} · ${p.allocations.length} line${p.allocations.length === 1 ? '' : 's'}`))),
      h('div', { class: 'side-actions' },
        h('button', { class: 'btn primary', onclick: () => store.addProject() }, '+ New project'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', title: 'Move up', onclick: () => store.moveProject(P().id, -1) }, '↑'),
          h('button', { class: 'btn small', title: 'Move down', onclick: () => store.moveProject(P().id, 1) }, '↓'),
          h('button', { class: 'btn small', onclick: () => store.duplicateActive() }, 'Copy'),
          h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Delete project "${P().title}"? This cannot be undone.`)) store.removeProject(P().id); } }, 'Delete'))),
      h('p', { class: 'hint' }, 'Projects live in this browser and work offline. Use File ▸ Save project as JSON to keep a file copy you can import later.'));
  }

  /* ---------------- 1 · project ---------------- */
  const text = (value: string, apply: (p: Project, v: string) => void, key: string, ph = '') =>
    h('input', { type: 'text', value, placeholder: ph, oninput: (e: Event) => store.mutate(p => apply(p, (e.target as HTMLInputElement).value), false, key) });

  function projectCard(p: Project) {
    return card('project', 'Project', 'title, subtitle, footer', [
      field('Title', text(p.title, (q, v) => (q.title = v), 'title', 'Project title')),
      field('Subtitle / description', text(p.subtitle, (q, v) => (q.subtitle = v), 'subtitle', 'e.g. Programme · Version · Date')),
      field('Footer text', text(p.footerText, (q, v) => (q.footerText = v), 'footer', 'e.g. website or confidentiality note (optional)')),
    ], 1);
  }

  /* ---------------- 2 · timeline ---------------- */
  function startControl(p: Project): HTMLElement {
    const d = parse(p.startDate);
    const apply = (iso: string) => store.mutate(q => { q.startDate = iso; }, true);
    const yearIn = (cur: number, make: (y: number) => string) =>
      h('input', { type: 'number', min: 1970, max: 2200, value: cur, class: 'yr', onchange: (e: Event) => apply(make(Number((e.target as HTMLInputElement).value) || cur)) });
    switch (p.scale) {
      case 'week':
        return h('div', { class: 'row' },
          h('input', { type: 'date', value: p.startDate, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) apply(periodStart(v, 'week')); } }),
          h('small', {}, `→ Monday, week ${isoWeek(p.startDate)}`));
      case 'month':
        return h('div', { class: 'row' },
          select(String(d.getUTCMonth()), MONTHS.map((m, i) => [String(i), m] as [string, string]), v => apply(fmt(new Date(Date.UTC(d.getUTCFullYear(), Number(v), 1))))),
          yearIn(d.getUTCFullYear(), y => fmt(new Date(Date.UTC(y, d.getUTCMonth(), 1)))));
      case 'quarter':
        return h('div', { class: 'row' },
          select(String(Math.floor(d.getUTCMonth() / 3)), [0, 1, 2, 3].map(q => [String(q), `Q${q + 1}`] as [string, string]), v => apply(fmt(new Date(Date.UTC(d.getUTCFullYear(), Number(v) * 3, 1))))),
          yearIn(d.getUTCFullYear(), y => fmt(new Date(Date.UTC(y, Math.floor(d.getUTCMonth() / 3) * 3, 1)))));
      case 'year':
        return yearIn(d.getUTCFullYear(), y => fmt(new Date(Date.UTC(y, 0, 1))));
    }
  }

  const WORK_PRESETS: [string, number[]][] = [['Mon–Fri', [1, 2, 3, 4, 5]], ['Mon–Sat', [1, 2, 3, 4, 5, 6]], ['Sun–Thu', [0, 1, 2, 3, 4]], ['Every day', [0, 1, 2, 3, 4, 5, 6]]];

  function timelineCard(p: Project) {
    const unit = UNIT_NAME[p.scale];
    const relNumbers = !p.useDates || p.numbering === 'relative';
    const hol = store.holidaysFor(p);
    const order = [1, 2, 3, 4, 5, 6, 0];
    return card('timeline', 'Timeline', `${p.useDates ? 'dated' : 'no dates'} · ${p.scale}ly · ${p.periods} columns`, [
      field('Timeline type', select(p.useDates ? 'dated' : 'relative', [['dated', 'Calendar dates (set a start date)'], ['relative', `No dates — relative (${unit} 1, ${unit} 2, …)`]],
        v => store.mutate(q => setUseDates(q, v === 'dated'), true)),
        p.useDates ? undefined : 'Lines are placed by period number. Switch back any time — everything keeps its position.'),
      field('One column =', select(p.scale, [['week', 'a week'], ['month', 'a month'], ['quarter', 'a quarter'], ['year', 'a year']],
        v => store.mutate(q => { q.scale = v as Scale; q.startDate = periodStart(q.startDate, q.scale); q.periods = DEFAULT_PERIODS[q.scale]; q.view.colWidth = 0; }, true)),
        'The grain of the table: loading is shown per week, month, quarter or year.'),
      GROUP_OPTIONS[p.scale].length > 1 ? field('Group the columns under', select(p.groupBy ?? 'auto',
        [['auto', `Automatic (${GROUP_LABEL[effectiveGroupBy(p)]})`], ...GROUP_OPTIONS[p.scale].map(g => [g, GROUP_LABEL[g]] as [string, string])],
        v => store.mutate(q => { q.groupBy = v as GroupBy; }, true)),
        `Adds a header row above the ${p.scale === 'week' ? 'weeks' : p.scale === 'month' ? 'months' : 'quarters'}, e.g. ${p.scale === 'week' ? 'weeks under months or quarters' : p.scale === 'month' ? 'months under quarters or years' : 'quarters under years'}.`) : undefined,
      p.useDates ? field(`Timeline starts at (${p.scale})`, startControl(p)) : undefined,
      p.useDates ? checkbox(`Label columns “${p.scale === 'week' ? 'W' : p.scale === 'month' ? 'M' : p.scale === 'quarter' ? 'Q' : 'Y'}${p.firstIndex}, …” instead of calendar names`, p.numbering === 'relative', v => store.mutate(q => { q.numbering = v ? 'relative' : 'calendar'; }, true)) : undefined,
      relNumbers ? field('First column is numbered', select(String(p.firstIndex), [['1', '1'], ['0', '0']], v => store.mutate(q => { q.firstIndex = Number(v); }, true))) : undefined,
      field(`Number of columns (${p.scale}s)`, num(p.periods, 1, 120, 1, n => store.mutate(q => { q.periods = Math.floor(n); }, true))),
      h('div', { class: 'subhead' }, 'Working days'),
      field('Days of the week that count', h('div', { class: 'row wrap' }, ...order.map(i =>
        checkbox(DOW[i], p.workDays.includes(i), on => {
          if (!on && p.workDays.length <= 1) { toast('At least one working day is needed', 'error'); store.refresh(); return; }
          store.mutate(q => { q.workDays = on ? [...new Set([...q.workDays, i])].sort() : q.workDays.filter(x => x !== i); }, true);
        }))),
        'Only these days carry load. Weekly headcount ignores the other days; FTE and person-days are measured over these days only.'),
      h('div', { class: 'row wrap' }, h('span', { class: 'fhint' }, 'Quick set:'), ...WORK_PRESETS.map(([l, d]) =>
        h('button', { class: 'btn tiny' + (JSON.stringify(p.workDays) === JSON.stringify(d) ? ' on' : ''), onclick: () => store.mutate(q => { q.workDays = [...d]; }, true) }, l))),
      p.useDates
        ? field('Public holiday lists used by this project', h('div', { class: 'row wrap' },
          ...(store.lib.holidayLists.length ? store.lib.holidayLists.map(l => checkbox(`${l.name} (${l.holidays.length})`, p.holidayListIds.includes(l.id),
            on => store.mutate(q => { q.holidayListIds = on ? [...q.holidayListIds, l.id] : q.holidayListIds.filter(x => x !== l.id); }, true))) : [h('small', {}, 'No lists yet. ')]),
          h('button', { class: 'btn small', onclick: openHolidayDialog }, 'Manage lists…')),
          hol.length ? `${hol.length} holiday${hol.length === 1 ? '' : 's'} excluded from working days.` : 'Holidays are not working days, so they carry no load.')
        : h('p', { class: 'hint' }, 'Public holidays only apply to timelines with calendar dates.'),
    ], 2);
  }

  /* ---------------- 3 / 4 · work streams and skills ---------------- */
  function nameList<T extends Workstream | Skill>(p: Project, key: 'workstreams' | 'skills', label: string, addId: string, usage: (id: string) => number) {
    const list = p[key] as T[];
    const move = (id: string, dir: -1 | 1) => store.mutate(q => {
      const arr = q[key] as T[], i = arr.findIndex(x => x.id === id), j = i + dir;
      if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
    }, true);
    const addInput = h('input', { type: 'text', id: addId, placeholder: `New ${label}, then press Enter`, onkeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const v = (e.target as HTMLInputElement).value.trim(); if (!v) return;
      pendingFocus = '#' + addId;
      store.mutate(q => { (q[key] as T[]).push({ id: uid(), name: v, color: nextColor((q[key] as T[]).map(x => x.color)) } as T); }, true);
    } }) as HTMLInputElement;
    return [
      ...list.map(it => h('div', { class: 'nrow' },
        h('input', { type: 'color', value: it.color, title: 'Colour', oninput: (e: Event) => store.mutate(q => { const x = (q[key] as T[]).find(i => i.id === it.id); if (x) x.color = (e.target as HTMLInputElement).value; }, false, `${it.id}:c`) }),
        h('input', { type: 'text', value: it.name, class: 'grow', oninput: (e: Event) => store.mutate(q => { const x = (q[key] as T[]).find(i => i.id === it.id); if (x) x.name = (e.target as HTMLInputElement).value; }, false, `${it.id}:n`), onchange: () => store.refresh() }),
        h('small', { class: 'usage', title: `Used in ${usage(it.id)} resource line(s)` }, usage(it.id) ? `${usage(it.id)} line${usage(it.id) === 1 ? '' : 's'}` : 'unused'),
        h('button', { class: 'btn tiny', title: 'Move up', onclick: () => move(it.id, -1) }, '↑'),
        h('button', { class: 'btn tiny', title: 'Move down', onclick: () => move(it.id, 1) }, '↓'),
        h('button', { class: 'btn tiny danger', title: 'Remove', onclick: () => {
          const n = usage(it.id);
          if (n && !confirm(`“${it.name}” is used in ${n} resource line(s). Remove it anyway? Those lines will show “No ${key === 'skills' ? 'skill' : 'work stream'}”.`)) return;
          store.mutate(q => {
            if (key === 'workstreams') {
              q.workstreams = q.workstreams.filter(x => x.id !== it.id);
              q.allocations.forEach(a => { if (a.workstreamId === it.id) a.workstreamId = ''; });
              q.resources.forEach(r => { if (r.workstreamId === it.id) r.workstreamId = undefined; });
              q.tasks.forEach(t => { if (t.workstreamId === it.id) t.workstreamId = undefined; });
            } else {
              q.skills = q.skills.filter(x => x.id !== it.id);
              q.allocations.forEach(a => { if (a.skillId === it.id) a.skillId = ''; });
              q.resources.forEach(r => { r.skillIds = r.skillIds.filter(s => s !== it.id); });
            }
          }, true);
        } }, '✕'))),
      list.length ? undefined : h('p', { class: 'empty' }, key === 'workstreams' ? 'No work streams yet. A work stream is a stream of work you load people onto, e.g. Backend, Frontend, QA.' : 'No skills yet. A skill is what people are loaded as, e.g. Developer, Designer, Tester.'),
      h('div', { class: 'row' }, addInput, h('button', { class: 'btn small', onclick: () => addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, '+ Add')),
    ].filter(Boolean) as HTMLElement[];
  }

  const workstreamsCard = (p: Project) => card('workstreams', 'Work streams', `${p.workstreams.length} defined`,
    nameList(p, 'workstreams', 'work stream', 'ws-add', id => p.allocations.filter(a => a.workstreamId === id).length), 3);
  const skillsCard = (p: Project) => card('skills', 'Skills', `${p.skills.length} defined`,
    nameList(p, 'skills', 'skill', 'sk-add', id => p.allocations.filter(a => a.skillId === id).length), 4);

  /* ---------------- 5 · resources ---------------- */
  function skillPicker(r: Resource, p: Project) {
    const cur = () => store.active().resources.find(x => x.id === r.id);
    const label = () => { const c = cur(); return c && c.skillIds.length ? c.skillIds.map(id => nameOf(P().skills, id)).join(', ') : 'Pick skills…'; };
    const summary = h('summary', { class: 'btn picker', title: 'The first skill ticked is the primary one — capacity is counted under it' }, label());
    const spans: [HTMLElement, string, string][] = [];
    const refresh = () => {
      const c = cur();
      for (const [span, id, name] of spans) span.textContent = name + (c?.skillIds[0] === id ? ' — primary' : '');
      summary.textContent = label();
    };
    const rows = p.skills.map(sk => {
      const span = h('span', {}, sk.name);
      spans.push([span, sk.id, sk.name]);
      return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.skillIds.includes(sk.id), onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        store.mutate(q => {
          const x = q.resources.find(i => i.id === r.id); if (!x) return;
          x.skillIds = on ? [...x.skillIds.filter(i => i !== sk.id), sk.id] : x.skillIds.filter(i => i !== sk.id);
        }, false);
        refresh();
      } }), span);
    });
    const d = h('details', { class: 'menu' }, summary,
      h('div', { class: 'menu-list skill-list' },
        ...(rows.length ? rows : [h('small', { class: 'pad' }, 'Add skills first (step 4).')]),
        rows.length ? h('small', { class: 'pad' }, 'The first skill ticked is the primary one. Other skills let the person be picked for those skills too.') : null));
    refresh();
    return d;
  }

  function resourcesCard(p: Project) {
    const cal = buildCalendar(buildAxis(p), p.workDays, p.useDates ? store.holidayDates(p) : []);
    const row = (r: Resource) => {
      const upd = (fn: (x: Resource) => void, structural = false, key?: string) =>
        store.mutate(q => { const x = q.resources.find(i => i.id === r.id); if (x) fn(x); }, structural, key ? `${r.id}:${key}` : undefined);
      const util = p.allocations.some(a => a.resourceId === r.id) ? resourceUtilisation(p, cal, r.id) : null;
      const over = util && util.overDays > 0;
      const open = openRows.has(r.id);
      return h('div', { class: 'iwrap' },
        h('div', { class: 'rrow', 'data-id': r.id },
          h('input', { type: 'text', value: r.name, class: 'name', placeholder: 'Name', oninput: (e: Event) => upd(x => (x.name = (e.target as HTMLInputElement).value), false, 'name'), onchange: () => store.refresh() }),
          skillPicker(r, p),
          num(r.fte, 0, 10, 0.25, n => upd(x => (x.fte = n), true), 'fte'),
          over ? h('span', { class: 'badge-over', title: `Assigned above their availability on ${util!.overDays} working day(s) — peak ${Number.isFinite(util!.peak) ? Math.round(util!.peak * 100) + '%' : 'while unavailable'}` }, '⚠') : h('span'),
          h('button', { class: 'btn tiny' + (open ? ' on' : ''), title: 'Home work stream, availability window, notes, delete…', onclick: () => { if (open) openRows.delete(r.id); else openRows.add(r.id); renderEditor(); } }, open ? '▴' : '⋯')),
        open && h('div', { class: 'idetail' },
          field('Home work stream', select(r.workstreamId ?? '', opts(p.workstreams, '— none —'), v => upd(x => (x.workstreamId = v || undefined), true))),
          field('Available from', dateInput(p, r.from, 'start', v => upd(x => (x.from = v), true), { optional: true }), 'Leave empty = whole timeline'),
          field('Available until', dateInput(p, r.to, 'end', v => upd(x => (x.to = v), true), { optional: true })),
          field('Note', h('input', { type: 'text', value: r.note ?? '', onchange: (e: Event) => upd(x => (x.note = (e.target as HTMLInputElement).value || undefined)) })),
          util ? h('p', { class: 'hint wide' }, `Peak load on ${r.name || 'this resource'}: ${Number.isFinite(util.peak) ? Math.round(util.peak * 100) + '% of availability' : 'assigned while unavailable'}${over ? ` — over-allocated on ${util.overDays} working day(s)` : ''}.`) : undefined,
          h('div', { class: 'row detail-actions' },
            h('button', { class: 'btn small danger', onclick: () => {
              openRows.delete(r.id);
              store.mutate(q => { q.resources = q.resources.filter(x => x.id !== r.id); q.allocations.forEach(a => { if (a.resourceId === r.id) a.resourceId = undefined; }); }, true);
            } }, 'Delete (keeps their loads as unassigned)'))));
    };
    const addInput = h('input', { type: 'text', id: 'res-add', placeholder: 'New resource name, then press Enter', onkeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const v = (e.target as HTMLInputElement).value.trim(); if (!v) return;
      pendingFocus = '#res-add';
      store.mutate(q => { q.resources.push({ id: uid(), name: v, skillIds: q.skills[0] ? [q.skills[0].id] : [], fte: 1 }); }, true);
    } }) as HTMLInputElement;
    const fte = p.resources.reduce((n, r) => n + r.fte, 0);
    return card('resources', 'Resources', `${p.resources.length} ${p.resources.length === 1 ? 'person' : 'people'} · ${fmtNum(fte)} FTE`, [
      h('p', { class: 'hint' }, 'Optional. Named people with their skills give you available capacity and let you spot over-allocation. You can also plan with anonymous numbers only (step 7).'),
      p.resources.length ? h('div', { class: 'rrow rhead' }, h('span', {}, 'Name'), h('span', {}, 'Skills'), h('span', { title: 'Availability: 1 = full time, 0.5 = half time' }, 'FTE'), h('span'), h('span')) : undefined,
      ...p.resources.map(row),
      h('div', { class: 'row' }, addInput, h('button', { class: 'btn small', onclick: () => addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, '+ Add')),
    ], 5);
  }

  /* ---------------- 6 · tasks ---------------- */
  function unlinkTasks(q: Project, taskIds: Set<string>) {
    for (const a of q.allocations) if (a.taskId && taskIds.has(a.taskId)) { const r = allocRange(a, q); a.start = r.start; a.end = r.end; delete a.taskId; }
  }

  function tasksCard(p: Project) {
    const row = (t: Task) => {
      const upd = (fn: (x: Task) => void, structural = false, key?: string) =>
        store.mutate(q => { const x = q.tasks.find(i => i.id === t.id); if (x) fn(x); }, structural, key ? `${t.id}:${key}` : undefined);
      const needs = p.allocations.filter(a => a.taskId === t.id);
      return h('div', { class: `trow k-${t.kind}`, 'data-id': t.id },
        h('input', { type: 'text', class: 'name', value: t.name, style: `padding-left:${6 + t.level * 12}px`, oninput: (e: Event) => upd(x => (x.name = (e.target as HTMLInputElement).value), false, 'name'), onchange: () => store.refresh() }),
        dateInput(p, t.start, 'start', v => upd(x => { x.start = v!; if (x.end < x.start) x.end = x.start; }, true)),
        dateInput(p, t.end, 'end', v => upd(x => { x.end = v!; if (x.end < x.start) x.start = x.end; }, true)),
        select(t.workstreamId ?? '', opts(p.workstreams, '— none —'), v => upd(x => (x.workstreamId = v || undefined), true)),
        t.kind === 'task'
          ? h('button', { class: 'btn tiny', title: needs.length ? `${needs.length} resource line(s) linked — add another` : 'Add a resource line for this task', onclick: () => addLoad(t) }, needs.length ? `+ ×${needs.length}` : '+ Load')
          : h('span', { class: 'kindtag', title: t.kind === 'group' ? 'Phase: a summary of the tasks below it' : 'Milestone' }, t.kind === 'group' ? 'phase' : 'milestone'),
        h('button', { class: 'btn tiny danger', title: 'Remove task', onclick: () => store.mutate(q => { unlinkTasks(q, new Set([t.id])); q.tasks = q.tasks.filter(x => x.id !== t.id); }, true) }, '✕'));
    };
    return card('tasks', 'Tasks', p.tasks.length ? `${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'}` : 'optional · import from Timeline Builder', [
      h('p', { class: 'hint' }, 'Tasks are optional. Import them from a Timeline Builder project, or add them by hand, then attach resources to each (“+ Load”). A resource line linked to a task follows the task’s dates.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary small', onclick: openTimelineImportDialog }, '⇪ Import from Timeline Builder…'),
        h('button', { class: 'btn small', onclick: () => store.mutate(q => {
          const last = q.tasks[q.tasks.length - 1];
          const start = last ? last.start : axisStart(q);
          q.tasks.push({ id: uid(), name: 'New task', start, end: last ? last.end : addDays(axisStart(q), 6), level: 0, kind: 'task' });
        }, true) }, '+ Add task'),
        p.tasks.length ? h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Remove all ${p.tasks.length} tasks? Resource lines linked to them keep their dates.`)) store.mutate(q => { unlinkTasks(q, new Set(q.tasks.map(t => t.id))); q.tasks = []; }, true); } }, 'Remove all') : undefined),
      p.tasks.length ? h('div', { class: 'trow thead' }, h('span', {}, 'Task'), h('span', {}, p.useDates ? 'Start' : 'From'), h('span', {}, p.useDates ? 'End' : 'To'), h('span', {}, 'Work stream'), h('span'), h('span')) : undefined,
      ...p.tasks.map(row),
    ], 6);
  }

  function addLoad(task?: Task) {
    const id = uid();
    openRows.add(id);
    ui.open.loading = true; saveUi();
    store.mutate(p => {
      const last = p.allocations[p.allocations.length - 1];
      const a = newAllocation(p, axisStart(p), timelineEnd(p));
      a.id = id;
      if (last) { a.workstreamId = last.workstreamId; a.skillId = last.skillId; }
      if (task) { a.taskId = task.id; a.workstreamId = task.workstreamId ?? a.workstreamId; a.start = task.start; a.end = task.end; }
      p.allocations.push(a);
    }, true);
    requestAnimationFrame(() => focusAlloc(id));
  }

  /* ---------------- 7 · resource loading ---------------- */
  /** The people who can be put on a line: those with the line's skill (everyone while no skill is chosen). */
  function resourceChoices(p: Project, a: Allocation): [string, string][] {
    const list = resourcesWithSkill(p, a.skillId);
    const out: [string, string][] = [['', '— anonymous (just a number) —'], ...list.map(r => [r.id, resourceLabel(r, p.skills)] as [string, string])];
    const cur = p.resources.find(r => r.id === a.resourceId);
    // keep an existing assignment visible even if the skill was changed afterwards, but say it no longer fits
    if (cur && !list.some(r => r.id === cur.id)) out.push([cur.id, `${resourceLabel(cur, p.skills)} — does not have ${nameOf(p.skills, a.skillId, 'this skill')}`]);
    return out;
  }
  function resourceHint(p: Project, a: Allocation): string {
    if (!a.skillId) return 'Pick a skill first to narrow this list to the people who have it. Leave empty to ask for “N people of this skill”.';
    const n = resourcesWithSkill(p, a.skillId).length, sk = nameOf(p.skills, a.skillId);
    return n ? `Showing the ${n} resource${n === 1 ? '' : 's'} with the skill “${sk}”. Leave empty to ask for “N people of this skill”.` : `No resource has the skill “${sk}” yet — tick it on a resource in step 5.`;
  }

  function loadingCard(p: Project) {
    const row = (a: Allocation) => {
      const upd = (fn: (x: Allocation, q: Project) => void, structural = false, key?: string) =>
        store.mutate(q => { const x = q.allocations.find(i => i.id === a.id); if (x) fn(x, q); }, structural, key ? `${a.id}:${key}` : undefined);
      const linked = a.taskId ? p.tasks.find(t => t.id === a.taskId) : undefined;
      const r = allocRange(a, p);
      const open = openRows.has(a.id);
      const res = p.resources.find(x => x.id === a.resourceId);
      const skillName = nameOf(p.skills, a.skillId, '');
      const lacks = !!(res && a.skillId && !res.skillIds.includes(a.skillId));
      const bits = [linked ? `⛓ Task: ${linked.name}` : '', res ? `👤 ${resourceLabel(res, p.skills)}` : '', lacks ? `⚠ ${res!.name} does not have the skill ${skillName}` : '', a.label ? `“${a.label}”` : ''].filter(Boolean);
      const sw = p.workstreams.find(w => w.id === a.workstreamId)?.color ?? p.skills.find(s => s.id === a.skillId)?.color ?? '#94a3b8';
      return h('div', { class: 'iwrap' + (open ? ' open' : ''), 'data-id': a.id },
        h('div', { class: 'arow' },
          h('span', { class: 'swatch', style: `background:${sw}` }),
          select(a.workstreamId, opts(p.workstreams, '— work stream —'), v => upd(x => (x.workstreamId = v), true)),
          select(a.skillId, opts(p.skills, '— skill —'), v => upd(x => (x.skillId = v), true)),
          dateInput(p, r.start, 'start', v => upd(x => { x.start = v!; if (x.end < x.start) x.end = x.start; }, true), { disabled: !!linked }),
          dateInput(p, r.end, 'end', v => upd(x => { x.end = v!; if (x.end < x.start) x.start = x.end; }, true), { disabled: !!linked }),
          num(a.count, 0, 1000, 0.5, n => upd(x => (x.count = n), true), 'qty'),
          h('button', { class: 'btn tiny' + (open ? ' on' : ''), title: 'Named resource, linked task, label, note, duplicate, delete…', onclick: () => { if (open) openRows.delete(a.id); else openRows.add(a.id); renderEditor(); } }, open ? '▴' : '⋯')),
        bits.length ? h('div', { class: 'asub' }, bits.join('  ·  ')) : undefined,
        open && h('div', { class: 'idetail' },
          field('Named resource', select(a.resourceId ?? '', resourceChoices(p, a), v => upd((x, q) => {
            x.resourceId = v || undefined;
            const rr = q.resources.find(i => i.id === v);
            if (rr) { if (!x.skillId && rr.skillIds[0]) x.skillId = rr.skillIds[0]; if (!x.workstreamId && rr.workstreamId) x.workstreamId = rr.workstreamId; if (x.count > rr.fte && rr.fte > 0) x.count = rr.fte; }
          }, true)), resourceHint(p, a)),
          field('Linked task', select(a.taskId ?? '', opts(p.tasks.filter(t => t.kind !== 'group'), '— none (own dates) —'), v => upd((x, q) => {
            if (v) { x.taskId = v; const t = q.tasks.find(i => i.id === v); if (t && !x.workstreamId && t.workstreamId) x.workstreamId = t.workstreamId; }
            else { const cur = allocRange(x, q); x.start = cur.start; x.end = cur.end; delete x.taskId; }
          }, true)), 'A linked line follows the task’s start and end'),
          field('Label (shown when rows are listed one per line)', h('input', { type: 'text', value: a.label, placeholder: linked ? linked.name : 'e.g. API build', oninput: (e: Event) => upd(x => (x.label = (e.target as HTMLInputElement).value), false, 'label'), onchange: () => store.refresh() })),
          field('Note', h('input', { type: 'text', value: a.note ?? '', onchange: (e: Event) => upd(x => (x.note = (e.target as HTMLInputElement).value || undefined)) })),
          h('div', { class: 'row detail-actions' },
            h('button', { class: 'btn small', onclick: () => store.mutate(q => { const k = q.allocations.findIndex(i => i.id === a.id); q.allocations.splice(k + 1, 0, { ...JSON.parse(JSON.stringify(a)), id: uid() }); }, true) }, 'Duplicate'),
            h('button', { class: 'btn small danger', onclick: () => { openRows.delete(a.id); store.mutate(q => { q.allocations = q.allocations.filter(i => i.id !== a.id); }, true); } }, 'Delete'))));
    };
    const total = p.allocations.length;
    return card('loading', 'Resource loading', `${total} line${total === 1 ? '' : 's'}`, [
      h('p', { class: 'hint' }, `Each line says: this many people, of this skill, on this work stream, ${p.useDates ? 'between these dates' : `from ${UNIT_NAME[p.scale].toLowerCase()} to ${UNIT_NAME[p.scale].toLowerCase()}`}. The table totals everything for you, per ${p.scale}.`),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary small', onclick: () => addLoad() }, '+ Add line'),
        total ? h('button', { class: 'btn small', onclick: () => { const all = p.allocations.every(a => openRows.has(a.id)); p.allocations.forEach(a => (all ? openRows.delete(a.id) : openRows.add(a.id))); renderEditor(); } }, 'Toggle all details') : undefined),
      total ? h('div', { class: 'arow ahead' }, h('span'), h('span', {}, 'Work stream'), h('span', {}, 'Skill'), h('span', {}, p.useDates ? 'From' : `From ${UNIT_NAME[p.scale].toLowerCase()} #`), h('span', {}, p.useDates ? 'To' : `To ${UNIT_NAME[p.scale].toLowerCase()} #`), h('span', { title: 'Number of people (0.5 = half a person)' }, '#'), h('span')) : h('p', { class: 'empty' }, 'No lines yet. Add a line, or import tasks from Timeline Builder and give each one a skill.'),
      ...p.allocations.map(row),
    ], 7);
  }

  /** Jump from the preview to a task in the Tasks section. */
  function focusTask(id: string) {
    if (!ui.editor) { ui.editor = true; saveUi(); applyLayoutClasses(); }
    if (!ui.open.tasks) { ui.open.tasks = true; saveUi(); renderEditor(); }
    const el = editor.querySelector(`.trow[data-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  /** Jump from the preview (or a “+ Load” button) to a resource line in the editor. */
  function focusAlloc(id: string) {
    if (!ui.editor) { ui.editor = true; saveUi(); applyLayoutClasses(); }
    if (!ui.open.loading) { ui.open.loading = true; saveUi(); renderEditor(); }
    const el = editor.querySelector(`.iwrap[data-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  /* ---------------- 8 · cost ---------------- */
  function costCard(p: Project) {
    const c = p.cost;
    const setCost = (fn: (x: Project['cost']) => void) => store.mutate(q => { fn(q.cost); }, true);
    const enable = checkbox('Use cost calculations', c.enabled, on => { setCost(x => { x.enabled = on; }); if (on) { ui.costTip = true; saveUi(); toast('Tip: hover any cost figure in the table to see how it is calculated.'); } }, 'Switch off to hide every cost field and keep cost out of the table and exports (the rates are kept)');
    if (!c.enabled) {
      return card('cost', 'Cost', 'optional · off', [
        h('p', { class: 'hint' }, 'Put a price on the plan: give each resource (or skill) a cost per person-day and the table, and a separate sheet in the Excel export, show the cost per period, person-months and totals.'),
        enable,
      ]);
    }
    const pm = pmDaysOf(p), auto = pmDaysAuto(p.workDays);
    const cal = buildCalendar(buildAxis(p), p.workDays, p.useDates ? store.holidayDates(p) : []);
    const sum = costSummary(p, cal);
    const active = costActive(p);
    const rateIn = (value: number | undefined, placeholder: string, on: (n: number | undefined) => void) =>
      h('input', { type: 'number', class: 'rate', min: 0, step: 10, value: value ?? '', placeholder, onchange: (e: Event) => {
        const raw = (e.target as HTMLInputElement).value, n = Number(raw);
        on(raw === '' || !Number.isFinite(n) || n <= 0 ? undefined : Math.round(n * 100) / 100);
      } });
    const monthly = (rate: number | undefined) => h('span', { class: 'pmrate', title: rate ? `${fmtMoneyFull(rate, c.currency)} per person-day × ${fmtPlain(pm)} working days = ${fmtMoneyFull(rate * pm, c.currency)} per person-month` : `1 person-month = ${fmtPlain(pm)} working days` }, rate ? fmtMoneyFull(rate * pm, c.currency) : '—');
    const resourceRows = p.resources.map(r => {
      const skillRate = p.skills.find(s => s.id === r.skillIds[0])?.dayRate;
      const eff = r.dayRate ?? skillRate;
      return h('div', { class: 'crow' },
        h('span', { class: 'cname', title: resourceLabel(r, p.skills) }, h('span', { class: 'cn' }, r.name), r.skillIds.length ? h('small', { class: 'cskill' }, r.skillIds.map(id => nameOf(p.skills, id)).join(', ')) : null),
        rateIn(r.dayRate, skillRate ? `${fmtMoneyFull(skillRate, c.currency)} (skill)` : 'none', n => store.mutate(q => { const x = q.resources.find(i => i.id === r.id); if (x) x.dayRate = n; }, true)),
        monthly(eff));
    });
    const skillRows = p.skills.map(s => h('div', { class: 'crow' },
      h('span', { class: 'cname', title: s.name }, h('span', { class: 'dot', style: `background:${s.color}` }), s.name),
      rateIn(s.dayRate, 'none', n => store.mutate(q => { const x = q.skills.find(i => i.id === s.id); if (x) x.dayRate = n; }, true)),
      monthly(s.dayRate)));
    const head = h('div', { class: 'crow chead' }, h('span'), h('span', {}, `per person-day`), h('span', {}, `per person-month`));
    return card('cost', 'Cost', active ? `${fmtMoneyFull(sum.totalCost, c.currency)} · ${fmtPlain(sum.personMonths)} person-months` : 'on · no rates yet', [
      enable,
      h('div', { class: 'grid2' },
        field('Currency', h('div', { class: 'row' },
          select(isKnownCurrency(c.currency) ? c.currency : '__other', [
            ...CURRENCIES.map(k => [k.code, `${k.symbol.trim()} ${k.code} — ${k.name}`] as [string, string]), ['__other', 'Other / none…']],
            v => setCost(x => { x.currency = v === '__other' ? '' : v; }), 'cur'),
          isKnownCurrency(c.currency) ? h('span') : h('input', { type: 'text', class: 'curtext', value: c.currency, maxlength: 8, placeholder: 'symbol or code', title: 'Printed next to every amount. Leave empty for plain numbers.',
            onchange: (e: Event) => setCost(x => { x.currency = (e.target as HTMLInputElement).value.trim(); }) })),
          `Amounts are shown like ${fmtMoneyFull(12345.5, c.currency)}.`),
        field('Working days in one person-month', h('div', { class: 'row' },
          select(c.pmDays > 0 ? 'custom' : 'auto', [['auto', `Automatic: ${fmtPlain(auto)}`], ['custom', 'My own number']], v => setCost(x => { x.pmDays = v === 'auto' ? 0 : Math.round(auto) || 20; })),
          c.pmDays > 0 ? num(c.pmDays, 1, 31, 0.5, n => setCost(x => { x.pmDays = n; }), 'pmdays') : h('span')),
          c.pmDays > 0 ? 'Your number is used for every person-month figure.' : `Automatic = ${p.workDays.length} working days a week × 52 ÷ 12. Switch to your own number to override it (e.g. 20 or 22).`)),
      h('div', { class: 'subhead' }, `Cost per person-day${c.currency ? ` (${c.currency})` : ''}`),
      h('p', { class: 'hint' }, 'A resource’s own rate wins. Lines with no named resource — and resources with no rate of their own — use the standard rate of the skill. The month rate is the day rate × the person-month above.'),
      h('div', { class: 'crows' },
        p.resources.length || p.skills.length ? head : undefined,
        p.resources.length ? h('div', { class: 'subhead soft' }, 'Resources') : undefined,
        ...resourceRows,
        p.skills.length ? h('div', { class: 'subhead soft' }, 'Skills — standard rates') : h('p', { class: 'empty' }, 'Add skills (step 4) or resources (step 5) to set their rates.'),
        ...skillRows),
      active
        ? h('div', { class: 'costsum', title: `Total cost = the sum over every resource line of: people × working days × cost per person-day.\n${fmtPlain(sum.totalPersonDays)} person-days ÷ ${fmtPlain(sum.pmDays)} working days per person-month = ${fmtPlain(sum.personMonths)} person-months.\nHover a figure in the table to see the working behind it.` },
          h('div', {}, h('strong', {}, fmtMoneyFull(sum.totalCost, c.currency)), ` total cost over the timeline`),
          h('div', {}, `${fmtPlain(sum.totalPersonDays)} person-days = ${fmtPlain(sum.personMonths)} person-months`),
          sum.unpriced ? h('div', { class: 'warn' }, `${sum.unpriced} resource line${sum.unpriced === 1 ? ' has' : 's have'} no rate and ${sum.unpriced === 1 ? 'is' : 'are'} not priced.`) : undefined)
        : h('p', { class: 'hint' }, 'Enter at least one rate to see the cost in the table.'),
      h('div', { class: 'subhead' }, 'Show and export'),
      h('div', { class: 'row wrap' },
        checkbox('Show cost in the table', p.view.showCost, on => store.mutate(q => { q.view.showCost = on; }, true), 'Hide the Cost section without losing the rates'),
        checkbox('Cost sheet in Excel export', c.exportSheet, on => setCost(x => { x.exportSheet = on; }), 'A separate sheet in the same workbook'),
        checkbox('Cost rows in exports', c.exportRows, on => setCost(x => { x.exportRows = on; }), 'The cost section of the table in the Excel plan sheet and in SVG / PNG')),
      h('p', { class: 'hint' }, '💡 Hover any cost figure in the table — a period, a total, the effort — to see exactly how it is calculated.'),
      h('p', { class: 'hint' }, 'Whenever cost is in use you are asked, at export time, whether to include it — tick or untick it there.'),
    ], 8);
  }

  /* ---------------- 8 · table content ---------------- */
  function contentCard(p: Project) {
    const v = p.view;
    const setView = <K extends keyof Project['view']>(k: K, val: Project['view'][K]) => store.mutate(q => { q.view[k] = val; }, true);
    const cb = (label: string, k: keyof Project['view'], title?: string) => checkbox(label, v[k] as boolean, on => setView(k, on as any), title);
    const m = MEASURES.find(x => x.id === v.measure)!;
    return card('content', 'Table content', `${ROW_GROUP_LABEL[v.groupBy].toLowerCase()} · ${m.label.toLowerCase()}`, [
      field('Group rows by', select(v.groupBy, (Object.keys(ROW_GROUP_LABEL) as RowGroup[]).map(k => [k, ROW_GROUP_LABEL[k]] as [string, string]), x => setView('groupBy', x as RowGroup))),
      field('Rows', select(v.detail, [
        ['auto', 'Automatic — one row per task when there are tasks, else per skill'],
        ['tasks', 'One row per task (lines on the same task are added together)'],
        ['skills', 'One row per skill (lines that share work stream and skill are merged)'],
        ['lines', 'One row per resource line']], x => setView('detail', x as Project['view']['detail'])),
        'Imported tasks appear as rows straight away; resource lines linked to a task are added to its row.'),
      field('Each cell shows', select(v.measure, MEASURES.map(x => [x.id, x.label] as [string, string]), x => setView('measure', x as Measure)), m.help),
      h('div', { class: 'subhead' }, 'Columns'),
      h('div', { class: 'row wrap' }, cb('Skill', 'colSkill'), cb('Resource', 'colResource'), cb('Start', 'colStart'), cb('End', 'colEnd'), cb('Qty', 'colQty', 'Most people on the row at once'), cb(`Total (${m.short.toLowerCase()})`, 'colTotal', 'One figure for the whole timeline')),
      h('div', { class: 'subhead' }, 'Rows & extras'),
      h('div', { class: 'row wrap' },
        cb('Group subtotals', 'showSubtotals'), cb('Tasks without resources', 'showEmptyTasks', 'List tasks that have no resource line yet, as blank rows'),  cb('Total loaded', 'showTotal'),
        cb('Available capacity', 'showCapacity', 'From the Resources list'), cb('Spare / shortfall', 'showGap', 'Capacity minus load'),
        cb('Working-days row', 'showWorkingDays', 'Working days in each column (calendar timelines)'),
        costActive(p) ? cb('Cost', 'showCost', 'The Cost section of the table (set up under “Cost”)') : undefined,
        cb('Legend', 'showLegend'), cb('Title', 'showTitle')),
      h('div', { class: 'subhead' }, 'Loading by skill'),
      checkbox('Show “Loading by skill”', v.showSkillSummary, on => setView('showSkillSummary', on), 'A section with the load of each skill, compared with its available capacity'),
      h('div', { class: 'indent-opt' }, checkbox('Named resources under each skill', v.showResources && v.showSkillSummary, on => setView('showResources', on),
        'List every named resource under their skill, with their own load — flagged where it exceeds their availability', !v.showSkillSummary || v.groupBy === 'resource')),
      v.groupBy === 'resource' ? h('p', { class: 'hint' }, 'Rows are grouped by resource already, so the resources are not repeated under the skills.') : !v.showSkillSummary ? h('p', { class: 'hint' }, 'Switch on “Loading by skill” to list resources under each skill.') : undefined,
      h('div', { class: 'grid2' },
        field('First column heading', h('input', { type: 'text', value: v.nameHeading, placeholder: 'automatic', onchange: (e: Event) => setView('nameHeading', (e.target as HTMLInputElement).value) })),
        field('Total row label', h('input', { type: 'text', value: v.totalLabel, placeholder: 'automatic', onchange: (e: Event) => setView('totalLabel', (e.target as HTMLInputElement).value) }))),
    ]);
  }

  /* ---------------- 9 · look & borders ---------------- */
  const BORDER_SETS: [string, Partial<Project['style']['borders']>][] = [
    ['All', { outer: true, header: true, rows: true, cols: true, labels: true, groups: true, total: true }],
    ['Horizontal only', { outer: false, header: true, rows: true, cols: false, labels: false, groups: true, total: true }],
    ['Outline only', { outer: true, header: true, rows: false, cols: false, labels: false, groups: false, total: false }],
    ['None', { outer: false, header: false, rows: false, cols: false, labels: false, groups: false, total: false }],
  ];
  function lookCard(p: Project) {
    const s = p.style, theme = store.themeFor(p);
    const tpl = TEMPLATES.find(t => t.id === p.templateId);
    const setStyle = (fn: (st: Project['style']) => void) => store.mutate(q => { fn(q.style); }, true);
    const bcheck = (label: string, k: keyof Project['style']['borders'], title: string) =>
      checkbox(label, s.borders[k], on => setStyle(st => { st.borders[k] = on; }), title);
    const sel = <K extends keyof Project['style']>(label: string, k: K, options: [string, string][]) =>
      field(label, select(String(s[k]), options, v => setStyle(st => { (st as any)[k] = v; })));
    return card('look', 'Look & borders', `${tpl ? tpl.name : 'custom'} · ${theme.name}`, [
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary small', onclick: openTemplateDialog }, '▦ Browse templates…'),
        h('span', { class: 'fhint' }, tpl ? `Using “${tpl.name}” (${tpl.inspiredBy})` : 'No template applied')),
      field('Theme (colours & font)', h('div', { class: 'row' },
        select(theme.id, store.allThemes().map(t => [t.id, t.name] as [string, string]), v => store.mutate(q => { q.themeId = v; }, true)),
        h('button', { class: 'btn small', onclick: openThemeDialog }, 'Customise…'))),
      h('div', { class: 'grid2' },
        sel('Cells', 'cell', (Object.keys(CELL_LABEL) as CellMode[]).map(k => [k, CELL_LABEL[k]] as [string, string])),
        sel('Header', 'header', [['solid', 'Solid band'], ['plain', 'Plain text'], ['underline', 'Underlined']]),
        sel('Group rows', 'group', [['tint', 'Light tint'], ['band', 'Solid band'], ['bold', 'Bold text only'], ['plain', 'Plain']]),
        sel('Numbers aligned', 'align', [['center', 'Centre'], ['right', 'Right'], ['left', 'Left']]),
        sel('Row height', 'density', [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']]),
        sel('Title style', 'title', [['plain', 'Plain, left'], ['center', 'Centred'], ['banner', 'Banner']])),
      h('div', { class: 'grid2' },
        field('Corner radius', num(s.radius, 0, 16, 1, n => setStyle(st => { st.radius = n; }))),
        field(`Column width (px, 0 = auto: ${DEFAULT_COL_W[p.scale]})`, num(p.view.colWidth, 0, 400, 2, n => store.mutate(q => { q.view.colWidth = n === 0 ? 0 : Math.max(24, n); }, true)))),
      h('div', { class: 'row wrap' },
        checkbox('Striped rows', s.zebra, on => setStyle(st => { st.zebra = on; })),
        checkbox('Show zeros', s.showZero, on => setStyle(st => { st.showZero = on; }))),
      h('div', { class: 'subhead' }, 'Borders — choose which lines to show'),
      h('div', { class: 'row wrap' },
        bcheck('Outer frame', 'outer', 'Line around the whole table'),
        bcheck('Under header', 'header', 'Line below the column headings'),
        bcheck('Between rows', 'rows', 'Horizontal lines between rows'),
        bcheck('Between columns', 'cols', 'Vertical lines between period columns'),
        bcheck('Around labels', 'labels', 'Vertical lines beside the label and total columns'),
        bcheck('Above groups', 'groups', 'Heavier line above each group'),
        bcheck('Around total row', 'total', 'Heavier lines above and below the total row')),
      h('div', { class: 'row wrap' }, h('span', { class: 'fhint' }, 'Quick set:'), ...BORDER_SETS.map(([l, b]) => h('button', { class: 'btn tiny', onclick: () => setStyle(st => { Object.assign(st.borders, b); }) }, l))),
      h('div', { class: 'grid2' },
        field('Line style', select(s.borderStyle, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], v => setStyle(st => { st.borderStyle = v as any; }))),
        field('Line thickness (px)', num(s.borderWidth, 0.5, 4, 0.5, n => setStyle(st => { st.borderWidth = n; })))),
    ]);
  }

  /* ---------------- editor pane ---------------- */
  function steps(p: Project) {
    const items: [string, string, boolean][] = [
      ['timeline', 'Timeline', true], ['workstreams', 'Work streams', p.workstreams.length > 0], ['skills', 'Skills', p.skills.length > 0],
      ['resources', 'Resources', p.resources.length > 0], ['tasks', 'Tasks', p.tasks.length > 0], ['loading', 'Loading', p.allocations.length > 0],
    ];
    return h('div', { class: 'steps' }, ...items.map(([id, label, done], i) => h('button', {
      class: 'stepchip' + (done ? ' done' : ''), title: `Go to “${label}”`,
      onclick: () => { ui.open[id] = true; saveUi(); renderEditor(); (editor.querySelector(`[data-card="${id}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    }, `${done ? '✓' : i + 1} ${label}`)));
  }

  function renderEditor() {
    const scroll = editor.scrollTop;
    const p = P();
    const setAll = (open: boolean) => { CARDS.forEach(k => (ui.open[k] = open)); saveUi(); renderEditor(); };
    editor.replaceChildren(
      h('div', { class: 'editor-head' }, h('strong', {}, 'Editor'), h('span', { class: 'spacer' }),
        h('button', { class: 'linkbtn', onclick: () => setAll(true) }, 'Expand all'), h('button', { class: 'linkbtn', onclick: () => setAll(false) }, 'Collapse all')),
      steps(p),
      projectCard(p), timelineCard(p), workstreamsCard(p), skillsCard(p), resourcesCard(p), tasksCard(p), loadingCard(p), costCard(p), contentCard(p), lookCard(p));
    editor.scrollTop = scroll;
    if (pendingFocus) { const el = editor.querySelector(pendingFocus) as HTMLInputElement | null; pendingFocus = ''; el?.focus(); }
  }

  /* ---------------- preview ---------------- */
  function applyZoom() {
    const svg = preview.querySelector('svg');
    if (svg && layout) { svg.style.width = `${layout.width * zoom}px`; svg.style.height = `${layout.height * zoom}px`; }
  }
  function renderPreview() {
    const p = P();
    layout = renderPlan(p, store.themeFor(p), store.holidayDates(p), { interactive: true });
    preview.innerHTML = layout.svg;
    const costShown = costActive(p) && p.view.showCost;
    costTip.hidden = !(costShown && ui.costTip);
    previewFoot.textContent = costShown ? COST_FOOT : FOOT;
    // a project opens fitted to the pane (never enlarged); later edits keep whatever zoom the user chose
    if (fittedFor !== p.id && preview.clientWidth > 0) { fittedFor = p.id; setZoom(Math.min(1, (preview.clientWidth - 40) / layout.width)); }
    applyZoom();
  }
  preview.addEventListener('click', e => {
    const g = (e.target as Element).closest('[data-alloc]');
    const ids = g?.getAttribute('data-alloc')?.split(',') ?? [];
    const line = ids.find(i => !i.startsWith('task:'));
    if (line) focusAlloc(line);
    else if (ids[0]) focusTask(ids[0].slice(5)); // a task row that has no resource line yet
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
  });

  /* ---------------- wiring ---------------- */
  function updateUndo() {
    (undoBtn as HTMLButtonElement).disabled = !store.canUndo();
    (redoBtn as HTMLButtonElement).disabled = !store.canRedo();
  }
  function refreshAll() { renderSide(); renderEditor(); renderPreview(); updateUndo(); }
  store.subscribe(structural => {
    if (structural) refreshAll();
    else {
      renderPreview(); updateUndo();
      const t = side.querySelector('.proj.active .proj-title');
      if (t) t.textContent = P().title || 'Untitled';
    }
  });
  /** The guided tour: shows one section at a time, then puts the user's open / folded sections back. */
  function runTour() {
    if (touring) return;
    const before = { open: { ...ui.open }, sidebar: ui.sidebar, editor: ui.editor };
    touring = true;
    ui.sidebar = true; ui.editor = true; applyLayoutClasses();
    const showCard = (id: string) => { for (const k of CARDS) ui.open[k] = k === id; renderEditor(); };
    startTour(plannerTour({ showCard }), () => {
      touring = false;
      ui.open = before.open; ui.sidebar = before.sidebar; ui.editor = before.editor;
      applyLayoutClasses(); renderEditor(); saveUi();
      markTourDone(TOUR_KEY);
    });
  }

  applyLayoutClasses();
  refreshAll();
  // first visit: offer the tour (not in automated browsers, which it would only get in the way of)
  if (tourPending(TOUR_KEY) && !navigator.webdriver) setTimeout(runTour, 900);
}

