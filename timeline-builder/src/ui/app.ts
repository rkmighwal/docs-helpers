import { h, pickFile, toast } from './dom';
import { openHolidayDialog, openLicenseDialog, openThemeDialog } from './dialogs';
import { APP, formatReleaseDate } from '../about';
import { store } from '../store';
import { BarStyle, ITEM_TYPES, Item, ItemType, Project, Scale, newItem, setUseDates, uid } from '../model';
import { renderTimeline, Layout, itemLook } from '../render';
import { DOW, MONTHS, addDays, addPeriods, diffDays, fmt, isoWeek, parse, periodIndexOf, periodStart } from '../dates';
import { GROUP_OPTIONS, UNIT_NAME, axisStart, effectiveGroupBy } from '../scale';
import { SHAPES, ShapeId, shapeSvg } from '../shapes';
import { download, makeBundle, mergeImport, parseImport, readFileText, saveJsonFile, slug, svgToPng } from '../export';

const DEFAULT_PERIODS: Record<Scale, number> = { week: 12, month: 12, quarter: 8, year: 5 };
const TYPE_LABEL: Record<ItemType, string> = { task: 'Task', group: 'Phase', milestone: 'Milestone', gate: 'Gate', holiday: 'Holiday band', note: 'Note' };
const TYPE_HELP: Record<ItemType, string> = {
  task: 'A bar with a start and end', group: 'A summary bar spanning the indented items below it', milestone: 'A single-day marker',
  gate: 'A decision / check-point marker', holiday: 'A shaded band across all rows (shutdown, freeze…)', note: 'A small text annotation',
};
const BAR_STYLES: { id: BarStyle; label: string }[] = [
  { id: 'solid', label: 'Solid' }, { id: 'outline', label: 'Outline' }, { id: 'gradient', label: 'Gradient' },
  { id: 'striped', label: 'Striped' }, { id: 'shadow', label: 'Raised (shadow)' },
];
const GROUP_LABEL: Record<string, string> = { none: 'No grouping', month: 'Months', quarter: 'Quarters', year: 'Years' };
const isPoint = (t: ItemType) => t === 'milestone' || t === 'gate' || t === 'note';

/* ---- remembered UI state (open sections, collapsed panes) ---- */
interface UiState { open: Record<string, boolean>; sidebar: boolean; editor: boolean }
const UI_KEY = 'timeline-builder:ui';
const ui: UiState = (() => {
  try { return { open: {}, sidebar: true, editor: true, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') }; } catch { return { open: {}, sidebar: true, editor: true }; }
})();
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ } };

export function mountApp(root: HTMLElement) {
  let layout: Layout | null = null;
  let zoom = 1;
  let dragId: string | null = null;
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
  const previewPane = h('section', { class: 'preview' },
    h('div', { class: 'preview-bar' },
      h('button', { class: 'btn small', title: 'Show / hide the editor to give the preview more room', onclick: () => { ui.editor = !ui.editor; saveUi(); applyLayoutClasses(); } }, '◧ Editor'),
      h('strong', {}, 'Preview'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => setZoom((preview.clientWidth - 40) / (layout?.width || 1)) }, 'Fit width'),
      h('button', { class: 'btn small', onclick: () => setZoom(1) }, '100%'),
      zoomRange, zoomLabel),
    preview,
    h('div', { class: 'preview-foot' }, 'Drag a bar to move it · drag its left/right edge to resize · hover for details'));
  const foot = h('footer', { class: 'appfoot' },
    h('span', {}, `${APP.name} v${APP.version}`),
    h('span', { class: 'dot' }, '·'), h('span', {}, `Published ${formatReleaseDate(APP.releaseDate)}`),
    h('span', { class: 'dot' }, '·'),
    h('button', { class: 'linkbtn', title: 'Read the license', onclick: openLicenseDialog }, `${APP.licenseId} License`));
  root.append(top, h('div', { class: 'body' }, side, editor, previewPane), foot);

  /* ---------------- helpers ---------------- */
  const field = (label: string, input: HTMLElement | HTMLElement[], hint?: string) =>
    h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), input, hint && h('small', { class: 'fhint' }, hint));
  const select = (value: string, options: [string, string][], onChange: (v: string) => void) =>
    h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  const checkbox = (label: string, checked: boolean, on: (v: boolean) => void, title?: string) =>
    h('label', { class: 'check', title }, h('input', { type: 'checkbox', checked, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);

  function card(id: string, title: string, hint: string, body: (HTMLElement | false)[], defaultOpen = false) {
    const d = h('details', { class: 'card', open: ui.open[id] ?? defaultOpen },
      h('summary', {}, h('span', { class: 'card-title' }, title), h('span', { class: 'card-hint' }, hint)),
      h('div', { class: 'card-body' }, ...body));
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
    const r = await saveJsonFile(`${slug(p.title)}.timeline.json`, JSON.stringify(makeBundle(p, store.lib), null, 2));
    if (r !== 'cancelled') toast(r === 'saved' ? 'Saved to file' : 'Project JSON downloaded');
  };
  const doBackup = async () => {
    const r = await saveJsonFile('timeline-builder-backup.json', JSON.stringify({ app: 'timeline-builder', version: 1, ...store.lib }, null, 2));
    if (r !== 'cancelled') toast('Backup of all projects saved');
  };
  const currentSvg = () => renderTimeline(P(), store.themeFor(P()), { interactive: false, holidays: store.holidaysFor(P()) });
  const doSvg = () => { download(`${slug(P().title)}.svg`, currentSvg().svg, 'image/svg+xml'); };
  const doPng = async (scale: number) => {
    try { const r = currentSvg(); download(`${slug(P().title)}.png`, await svgToPng(r.svg, r.width, r.height, scale), 'image/png'); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  /* ---------------- top bar ---------------- */
  const statusEl = h('span', { class: 'status' }, '✓ Auto-saved in browser');
  const undoBtn = h('button', { class: 'btn', title: 'Undo (Ctrl/Cmd+Z)', onclick: () => store.undo() }, '↶');
  const redoBtn = h('button', { class: 'btn', title: 'Redo (Ctrl/Cmd+Shift+Z)', onclick: () => store.redo() }, '↷');
  top.append(
    h('button', { class: 'btn', title: 'Show / hide project list', onclick: () => { ui.sidebar = !ui.sidebar; saveUi(); applyLayoutClasses(); } }, '☰'),
    h('h1', {}, 'Timeline Builder'),
    menu('File', [
      ['New project', () => store.addProject()], ['Duplicate project', () => store.duplicateActive()], null,
      ['Open / import JSON…', doImport], ['Save project as JSON…', doSaveJson], ['Backup all projects…', doBackup], null,
      [`About & ${APP.licenseId} license…`, openLicenseDialog]]),
    menu('Export image', [
      ['SVG — vector, best for slides', doSvg], null,
      ['PNG — standard (2×)', () => doPng(2)], ['PNG — high resolution (4×)', () => doPng(4)], ['PNG — small (1×)', () => doPng(1)]], true),
    h('button', { class: 'btn', onclick: openThemeDialog }, '🎨 Designs'),
    h('button', { class: 'btn', onclick: openHolidayDialog }, '🗓 Holiday lists'),
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
        h('small', {}, `${p.useDates ? '' : 'relative · '}${p.scale} · ${p.items.length} items`))),
      h('div', { class: 'side-actions' },
        h('button', { class: 'btn primary', onclick: () => store.addProject() }, '+ New project'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', title: 'Move up', onclick: () => store.moveProject(P().id, -1) }, '↑'),
          h('button', { class: 'btn small', title: 'Move down', onclick: () => store.moveProject(P().id, 1) }, '↓'),
          h('button', { class: 'btn small', onclick: () => store.duplicateActive() }, 'Copy'),
          h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Delete project "${P().title}"? This cannot be undone.`)) store.removeProject(P().id); } }, 'Delete'))),
      h('p', { class: 'hint' }, 'Projects live in this browser and work offline. Use File ▸ Save project as JSON to keep a file copy.'));
  }

  /* ---------------- settings cards ---------------- */
  const text = (value: string, apply: (p: Project, v: string) => void, key: string, ph = '') =>
    h('input', { type: 'text', value, placeholder: ph, oninput: (e: Event) => store.mutate(p => apply(p, (e.target as HTMLInputElement).value), false, key) });

  function startControl(p: Project): HTMLElement {
    const d = parse(p.startDate);
    const set = (iso: string) => store.mutate(q => { q.startDate = iso; }, true);
    const yearIn = (cur: number, apply: (y: number) => string) =>
      h('input', { type: 'number', min: 1970, max: 2200, value: cur, class: 'yr', onchange: (e: Event) => set(apply(Number((e.target as HTMLInputElement).value) || cur)) });
    switch (p.scale) {
      case 'week':
        return h('div', { class: 'row' },
          h('input', { type: 'date', value: p.startDate, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) set(periodStart(v, 'week')); } }),
          h('small', {}, `→ Monday, week ${isoWeek(p.startDate)}`));
      case 'month':
        return h('div', { class: 'row' },
          select(String(d.getUTCMonth()), MONTHS.map((m, i) => [String(i), m]), v => set(fmt(new Date(Date.UTC(d.getUTCFullYear(), Number(v), 1))))),
          yearIn(d.getUTCFullYear(), y => fmt(new Date(Date.UTC(y, d.getUTCMonth(), 1)))));
      case 'quarter':
        return h('div', { class: 'row' },
          select(String(Math.floor(d.getUTCMonth() / 3)), [0, 1, 2, 3].map(q => [String(q), `Q${q + 1}`]), v => set(fmt(new Date(Date.UTC(d.getUTCFullYear(), Number(v) * 3, 1))))),
          yearIn(d.getUTCFullYear(), y => fmt(new Date(Date.UTC(y, Math.floor(d.getUTCMonth() / 3) * 3, 1)))));
      case 'year':
        return yearIn(d.getUTCFullYear(), y => fmt(new Date(Date.UTC(y, 0, 1))));
    }
  }

  function settingsCards(p: Project): HTMLElement[] {
    const theme = store.themeFor(p);
    const unit = UNIT_NAME[p.scale];
    const relNumbers = !p.useDates || p.numbering === 'relative';
    return [
      card('project', 'Project', 'title, subtitle, footer', [
        field('Title', text(p.title, (q, v) => (q.title = v), 'title', 'Project title')),
        field('Subtitle / description', text(p.subtitle, (q, v) => (q.subtitle = v), 'subtitle', 'e.g. Programme · Version · Date')),
        field('Footer text', text(p.footerText, (q, v) => (q.footerText = v), 'footer', 'e.g. website or confidentiality note (optional)')),
      ], true),
      card('view', 'Timeline view', `${p.useDates ? 'dates' : 'no dates'} · ${p.scale}ly`, [
        field('Timeline type', select(p.useDates ? 'dated' : 'relative', [['dated', 'Calendar dates (real start date)'], ['relative', `Relative — no dates (${unit} 0, ${unit} 1, …)`]],
          v => store.mutate(q => setUseDates(q, v === 'dated'), true)),
        p.useDates ? undefined : 'Items are placed by period number. Switch back any time — items keep their position.'),
        field('One column =', select(p.scale, [['week', 'a week'], ['month', 'a month'], ['quarter', 'a quarter'], ['year', 'a year']],
          v => store.mutate(q => { q.scale = v as Scale; q.startDate = periodStart(q.startDate, q.scale); q.periods = DEFAULT_PERIODS[q.scale]; }, true))),
        GROUP_OPTIONS[p.scale].length > 1 && field('Group the columns under', select(p.groupBy ?? 'auto',
          [['auto', `Automatic (${GROUP_LABEL[effectiveGroupBy(p)]})`], ...GROUP_OPTIONS[p.scale].map(g => [g, GROUP_LABEL[g]] as [string, string])],
          v => store.mutate(q => { q.groupBy = v as Project['groupBy']; }, true)),
          `Adds a header row above the ${p.scale === 'week' ? 'weeks' : p.scale === 'month' ? 'months' : 'quarters'}, e.g. ${p.scale === 'week' ? 'weeks under months or quarters' : p.scale === 'month' ? 'months under quarters or years' : 'quarters under years'}.`),
        p.useDates && field(`Timeline starts at (${p.scale})`, startControl(p)),
        p.useDates && checkbox(`Label columns “${unit} ${p.firstIndex}, ${unit} ${p.firstIndex + 1}…” instead of calendar names`, p.numbering === 'relative',
          v => store.mutate(q => { q.numbering = v ? 'relative' : 'calendar'; }, true)),
        relNumbers && field('First column is numbered', select(String(p.firstIndex), [['0', `${unit} 0`], ['1', `${unit} 1`]],
          v => store.mutate(q => { q.firstIndex = Number(v); }, true))),
        !p.useDates && field(`Current ${unit.toLowerCase()} (highlighted by some designs)`, h('input', { type: 'number', value: p.currentPeriod ?? '', placeholder: 'none', onchange: (e: Event) => store.mutate(q => { const v = (e.target as HTMLInputElement).value; q.currentPeriod = v === '' ? undefined : Number(v); }, true) })),
        field(`Number of columns (${p.scale}s)`, h('input', { type: 'number', min: 1, max: 120, value: p.periods, onchange: (e: Event) => store.mutate(q => { q.periods = Math.min(120, Math.max(1, Number((e.target as HTMLInputElement).value) || 1)); }, true) })),
      ].filter(Boolean) as HTMLElement[], true),
      card('calendar', 'Working calendar', p.useDates ? `${p.holidayListIds.length ? `${store.holidaysFor(p).length} holiday${store.holidaysFor(p).length === 1 ? '' : 's'} from ${p.holidayListIds.length} list${p.holidayListIds.length > 1 ? 's' : ''}` : store.lib.holidayLists.length ? 'no holiday list selected' : 'weekends & holidays'}` : 'weekends', [
        field('Weekend days — not counted as working days', h('div', { class: 'row wrap' }, ...DOW.map((n, i) =>
          checkbox(n, p.weekendDays.includes(i), on => store.mutate(q => { q.weekendDays = on ? [...new Set([...q.weekendDays, i])] : q.weekendDays.filter(x => x !== i); }, true))))),
        p.useDates
          ? field('Public holiday lists used by this project', h('div', { class: 'row wrap' },
            ...(store.lib.holidayLists.length ? store.lib.holidayLists.map(l => checkbox(`${l.name} (${l.holidays.length})`, p.holidayListIds.includes(l.id),
              on => store.mutate(q => { q.holidayListIds = on ? [...q.holidayListIds, l.id] : q.holidayListIds.filter(x => x !== l.id); }, true))) : [h('small', {}, 'No lists yet. ')]),
            h('button', { class: 'btn small', onclick: openHolidayDialog }, 'Manage lists…')), 'Tick a list to use it in this project. Lists are shared between projects. Holidays are skipped when counting working days and shown on the chart.')
          : h('p', { class: 'hint' }, 'Public holidays only apply to timelines with calendar dates.'),
      ], true),
      card('look', 'Appearance & legend', theme.name, [
        field('Design', h('div', { class: 'row' },
          select(theme.id, store.allThemes().map(t => [t.id, t.name] as [string, string]), v => store.mutate(q => { q.themeId = v; }, true)),
          h('button', { class: 'btn small', onclick: openThemeDialog }, 'Customise…'))),
        h('div', { class: 'row wrap' },
          checkbox(p.useDates ? 'Show dates beside bars' : `Show ${p.scale} range beside bars`, p.showDates, v => store.mutate(q => { q.showDates = v; }, true)),
          p.useDates && checkbox('Today line', p.showToday, v => store.mutate(q => { q.showToday = v; }, true)),
          p.scale === 'week' && checkbox('Shade weekends', p.showWeekends, v => store.mutate(q => { q.showWeekends = v; }, true)),
          p.useDates && checkbox('Show public holidays', p.showHolidays, v => store.mutate(q => { q.showHolidays = v; }, true))) as HTMLElement,
        h('div', { class: 'subhead' }, 'Legend'),
        h('div', { class: 'row wrap' },
          checkbox('Show legend', p.legend.show, v => store.mutate(q => { q.legend.show = v; }, true)),
          select(p.legend.position, [['bottom', 'Below the chart'], ['top', 'Above the chart'], ['right', 'Right of the chart']], v => store.mutate(q => { q.legend.position = v as any; }, true))),
        h('p', { class: 'hint' }, 'The legend is built automatically from the item types, colours and icons you use. Give an item a “Legend label” (in its details) to name its look. Add extra entries below if needed.'),
        ...p.legend.custom.map((c, i) => h('div', { class: 'row' },
          select(c.icon || '', [['', '▬ Swatch'], ...SHAPES.map(s => [s.id, s.label] as [string, string])], v => store.mutate(q => { q.legend.custom[i].icon = (v || undefined) as ShapeId | undefined; }, true)),
          h('input', { type: 'color', value: c.color, oninput: (e: Event) => store.mutate(q => { q.legend.custom[i].color = (e.target as HTMLInputElement).value; }, false, 'lc' + i) }),
          h('input', { type: 'text', value: c.label, placeholder: 'Legend text', oninput: (e: Event) => store.mutate(q => { q.legend.custom[i].label = (e.target as HTMLInputElement).value; }, false, 'll' + i) }),
          h('button', { class: 'btn small', title: 'Remove', onclick: () => store.mutate(q => { q.legend.custom.splice(i, 1); }, true) }, '✕'))),
        h('div', {}, h('button', { class: 'btn small', onclick: () => store.mutate(q => { q.legend.custom.push({ label: '', color: '#8b5cf6' }); }, true) }, '+ Extra legend entry')),
      ].filter(Boolean) as HTMLElement[]),
    ];
  }

  /* ---------------- items ---------------- */
  function blockEnd(items: Item[], i: number): number {
    let e = i + 1;
    if (items[i].type === 'group') while (e < items.length && items[e].level > items[i].level) e++;
    return e;
  }

  function addItem(type: ItemType) {
    const id = uid();
    openRows.add(id);
    store.mutate(p => {
      const last = [...p.items].reverse().find(i => i.type !== 'holiday' && i.type !== 'group');
      const start = last && type !== 'group' ? (isPoint(last.type) ? last.start : addDays(last.end, 1)) : axisStart(p);
      const it = newItem(type, start); it.id = id;
      const prev = p.items[p.items.length - 1];
      if (prev && type !== 'group') it.level = prev.type === 'group' ? Math.min(3, prev.level + 1) : prev.level;
      p.items.push(it);
    }, true);
    requestAnimationFrame(() => (editor.querySelector(`.irow[data-id="${id}"] .name`) as HTMLInputElement | null)?.select());
  }

  function badge(it: Item): string {
    const look = itemLook(it, store.themeFor(P()));
    let inner: string;
    if (isPoint(it.type) || it.icon) inner = shapeSvg(look.shape, 10, 10, 6.5, look.color, '#555', '#fff');
    else if (it.type === 'task') inner = `<rect x="1" y="6" width="18" height="8" rx="2.5" fill="${look.color}"/>`;
    else if (it.type === 'group') inner = `<path d="M1 5h18v6l-3-2.5H4L1 11z" fill="${look.color}"/>`;
    else inner = `<rect x="1" y="4" width="18" height="12" fill="${look.color}" fill-opacity="0.55" stroke="${look.color}"/>`;
    return `<svg viewBox="0 0 20 20" width="20" height="20">${inner}</svg>`;
  }

  function itemRow(it: Item, p: Project): HTMLElement {
    const dated = p.useDates, origin = axisStart(p), num0 = p.firstIndex || 0, unit = UNIT_NAME[p.scale];
    const point = isPoint(it.type), band = it.type === 'holiday';
    const upd = (fn: (i: Item) => void, structural = false, key?: string) =>
      store.mutate(q => { const x = q.items.find(i => i.id === it.id); if (x) fn(x); }, structural, key ? `${it.id}:${key}` : undefined);
    const look = itemLook(it, store.themeFor(p));
    const isOpen = openRows.has(it.id);

    const handle = h('span', { class: 'handle', title: 'Drag to reorder (a phase moves together with the items under it)', draggable: true }, '⠿');
    const badgeEl = h('span', { class: 'badge', title: `${TYPE_LABEL[it.type]} — ${TYPE_HELP[it.type]}` });
    badgeEl.innerHTML = badge(it);

    const dispIdx = (d: string) => String(periodIndexOf(d, origin, p.scale) + num0);
    const startIn = dated
      ? h('input', { type: 'date', class: 'f-start', value: it.start, title: 'Start date', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) upd(i => (i.start = v)); } })
      : h('input', { type: 'number', class: 'f-start', value: dispIdx(it.start), title: `Start ${unit.toLowerCase()} number`, onchange: (e: Event) => {
        const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) upd(i => (i.start = addPeriods(origin, p.scale, Math.round(n) - num0)));
      } });
    const endIn = dated
      ? h('input', { type: 'date', class: 'f-end', value: it.end, disabled: point, title: point ? 'Single-day item — no end date' : 'End date (the last day, inclusive)', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) upd(i => { i.end = v; i.durationMode = 'end'; }); } })
      : h('input', { type: 'number', class: 'f-end', value: point ? '' : dispIdx(it.end), disabled: point, title: point ? 'Single-point item — no end' : `Last ${unit.toLowerCase()} number (inclusive)`, onchange: (e: Event) => {
        const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) upd(i => { i.end = addDays(addPeriods(origin, p.scale, Math.round(n) - num0 + 1), -1); i.durationMode = 'end'; });
      } });
    const daysIn = h('input', { type: 'number', class: 'f-days', min: 1, value: point ? '' : it.workingDays, disabled: point || band, title: 'Working days — change this and the end is calculated (weekends & holidays skipped)', onchange: (e: Event) => upd(i => { i.workingDays = Math.max(1, Number((e.target as HTMLInputElement).value) || 1); i.durationMode = 'days'; }) });

    const main = h('div', { class: `irow t-${it.type}`, 'data-id': it.id },
      handle, badgeEl,
      h('input', { type: 'text', value: it.name, class: 'name', placeholder: 'Name', style: `padding-left:${6 + it.level * 14}px`, oninput: (e: Event) => upd(i => (i.name = (e.target as HTMLInputElement).value), false, 'name') }),
      startIn, endIn, daysIn,
      h('button', { class: 'btn tiny' + (isOpen ? ' on' : ''), title: 'Colour, icon, progress, legend label, delete…', onclick: () => { if (isOpen) openRows.delete(it.id); else openRows.add(it.id); renderItems(); } }, isOpen ? '▴' : '⋯'));

    handle.addEventListener('dragstart', e => {
      dragId = it.id; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', it.id);
      e.dataTransfer!.setDragImage(main, 10, 10); main.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => { dragId = null; main.classList.remove('dragging'); editor.querySelectorAll('.drop-above,.drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below')); });
    main.addEventListener('dragover', e => {
      if (!dragId) return; e.preventDefault();
      const r = main.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2;
      main.classList.toggle('drop-above', above); main.classList.toggle('drop-below', !above);
    });
    main.addEventListener('dragleave', () => main.classList.remove('drop-above', 'drop-below'));
    main.addEventListener('drop', e => {
      e.preventDefault();
      const r = main.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2;
      const from = dragId; dragId = null;
      if (!from || from === it.id) return;
      store.mutate(q => {
        const fi = q.items.findIndex(i => i.id === from), fe = blockEnd(q.items, fi);
        let ti = q.items.findIndex(i => i.id === it.id);
        if (ti >= fi && ti < fe) return;
        if (!above) ti = blockEnd(q.items, ti);
        const block = q.items.splice(fi, fe - fi);
        if (ti > fi) ti -= block.length;
        q.items.splice(ti, 0, ...block);
      }, true);
    });

    const wrap = h('div', { class: 'iwrap' }, main);
    if (isOpen) {
      wrap.append(h('div', { class: 'idetail' },
        field('Type', select(it.type, ITEM_TYPES.map(t => [t.type, t.label] as [string, string]),
          v => upd(i => { i.type = v as ItemType; if (i.type === 'task' || i.type === 'group') i.durationMode = 'days'; if (!i.workingDays) i.workingDays = 5; }, true))),
        it.type === 'task' && field('% complete', h('input', { type: 'number', min: 0, max: 100, value: it.progress, onchange: (e: Event) => upd(i => (i.progress = Math.min(100, Math.max(0, Number((e.target as HTMLInputElement).value) || 0))), true) })),
        field('Colour', h('div', { class: 'row' },
          h('input', { type: 'color', value: look.color, oninput: (e: Event) => upd(i => (i.color = (e.target as HTMLInputElement).value), false, 'color'), onchange: () => renderItems() }),
          h('button', { class: 'btn tiny', disabled: !it.color, onclick: () => upd(i => { delete i.color; }, true) }, 'Design colour'))),
        it.type !== 'holiday' && field(isPoint(it.type) ? 'Marker shape' : 'Icon beside name', select(it.icon || '', [['', isPoint(it.type) ? 'Design default' : 'None'], ...SHAPES.map(s => [s.id, s.label] as [string, string])],
          v => upd(i => { i.icon = (v || undefined) as ShapeId | undefined; }, true))),
        it.type === 'task' && field('Bar style', select(it.barStyle || '', [['', 'Design default'], ...BAR_STYLES.map(b => [b.id, b.label] as [string, string])],
          v => upd(i => { i.barStyle = (v || undefined) as BarStyle | undefined; }, true))),
        field('Legend label', h('input', { type: 'text', value: it.legendLabel || '', placeholder: 'e.g. Vendor work', onchange: (e: Event) => upd(i => { i.legendLabel = (e.target as HTMLInputElement).value || undefined; }, true) }), 'Names this colour/shape in the legend'),
        field('Indent level', h('div', { class: 'row' },
          h('button', { class: 'btn tiny', onclick: () => upd(i => (i.level = Math.max(0, i.level - 1)), true) }, '◂ Out'),
          h('span', {}, String(it.level)),
          h('button', { class: 'btn tiny', onclick: () => upd(i => (i.level = Math.min(3, i.level + 1)), true) }, 'In ▸'))),
        h('div', { class: 'row detail-actions' },
          h('button', { class: 'btn small', onclick: () => store.mutate(q => { const k = q.items.findIndex(i => i.id === it.id); q.items.splice(k + 1, 0, { ...JSON.parse(JSON.stringify(it)), id: uid(), name: it.name + ' (copy)' }); }, true) }, 'Duplicate'),
          h('button', { class: 'btn small danger', onclick: () => { openRows.delete(it.id); store.mutate(q => { q.items = q.items.filter(i => i.id !== it.id); }, true); } }, 'Delete'))));
    }
    return wrap;
  }

  const itemsHolder = h('div', { class: 'items-holder' });
  function renderItems() {
    const p = P(), unit = UNIT_NAME[p.scale];
    const hd = (label: string, title: string) => h('span', { title }, label);
    itemsHolder.replaceChildren(
      h('div', { class: 'add-bar' }, h('span', { class: 'flabel' }, 'Add:'),
        ...ITEM_TYPES.map(t => h('button', { class: 'btn small', title: TYPE_HELP[t.type], onclick: () => addItem(t.type) }, `+ ${TYPE_LABEL[t.type]}`))),
      h('div', { class: 'irow ihead' }, h('span'), h('span'),
        hd('Activity', 'Name shown on the timeline'),
        hd(p.useDates ? 'Start date' : `Start ${unit.toLowerCase()} #`, p.useDates ? 'First day of the item' : `Number of the ${unit.toLowerCase()} the item starts in`),
        hd(p.useDates ? 'End date' : `End ${unit.toLowerCase()} #`, p.useDates ? 'Last day of the item (inclusive)' : `Number of the ${unit.toLowerCase()} the item ends in (inclusive)`),
        hd('Working days', 'Duration in working days — edit this OR the end; the other is calculated'),
        hd('More', 'Open colour, icon, progress, legend label and delete')),
      ...(p.items.length ? p.items.map(i => itemRow(i, p)) : [h('p', { class: 'empty' }, 'No items yet. Use the “+ Add” buttons above — start with a Phase and a few Tasks.')]),
      h('p', { class: 'hint' }, 'Tip: edit either the end or the working days — the other is calculated, skipping weekends' + (p.useDates ? ' and holidays' : '') + '. Drag ⠿ to reorder.'));
  }

  /** Refresh computed fields in place so typing never loses focus. */
  function syncRows() {
    const p = P(), origin = axisStart(p), num0 = p.firstIndex || 0;
    for (const it of p.items) {
      const row = editor.querySelector(`.irow[data-id="${it.id}"]`);
      if (!row) continue;
      const set = (sel: string, v: string | number) => {
        const el = row.querySelector(sel) as HTMLInputElement | null;
        if (el && document.activeElement !== el && el.value !== String(v)) el.value = String(v);
      };
      const idx = (d: string) => periodIndexOf(d, origin, p.scale) + num0;
      set('.f-start', p.useDates ? it.start : idx(it.start));
      set('.f-end', isPoint(it.type) ? '' : p.useDates ? it.end : idx(it.end));
      set('.f-days', isPoint(it.type) ? '' : it.workingDays);
    }
  }

  /* ---------------- editor pane ---------------- */
  function renderEditor() {
    const scroll = editor.scrollTop;
    const p = P();
    const setAll = (open: boolean) => { ['project', 'view', 'calendar', 'look', 'items'].forEach(k => (ui.open[k] = open)); saveUi(); renderEditor(); };
    renderItems();
    editor.replaceChildren(
      h('div', { class: 'editor-head' }, h('strong', {}, 'Editor'), h('span', { class: 'spacer' }),
        h('button', { class: 'linkbtn', onclick: () => setAll(true) }, 'Expand all'), h('button', { class: 'linkbtn', onclick: () => setAll(false) }, 'Collapse all')),
      ...settingsCards(p),
      card('items', 'Timeline items', `${p.items.length} item${p.items.length === 1 ? '' : 's'}`, [itemsHolder], true));
    editor.scrollTop = scroll;
  }

  /* ---------------- preview + bar dragging ---------------- */
  function applyZoom() {
    const svg = preview.querySelector('svg');
    if (svg && layout) { svg.style.width = `${layout.width * zoom}px`; svg.style.height = `${layout.height * zoom}px`; }
  }
  function renderPreview() {
    const p = P();
    layout = renderTimeline(p, store.themeFor(p), { interactive: true, holidays: store.holidaysFor(p) });
    preview.innerHTML = layout.svg;
    applyZoom();
  }

  preview.addEventListener('pointerdown', e => {
    const target = (e.target as Element).closest('[data-role]');
    const g = (e.target as Element).closest('[data-id]');
    if (!target || !g || !layout || e.button !== 0) return;
    e.preventDefault();
    const id = g.getAttribute('data-id')!, role = target.getAttribute('data-role')!;
    const orig = JSON.parse(JSON.stringify(P().items.find(i => i.id === id)!)) as Item;
    const lay = layout;
    const svg = preview.querySelector('svg')!;
    const dayAt = (cx: number) => {
      const r = svg.getBoundingClientRect();
      return lay.axis.dateAt((cx - r.left) / (r.width / lay.width) - lay.chartX);
    };
    const startDay = dayAt(e.clientX);
    store.breakCoalesce();
    document.body.classList.add('dragging-bar');
    const move = (ev: PointerEvent) => {
      const delta = diffDays(startDay, dayAt(ev.clientX));
      store.mutate(p => {
        const it = p.items.find(i => i.id === id)!;
        if (role === 'move') {
          it.start = addDays(orig.start, delta);
          if (it.durationMode === 'end') it.end = addDays(orig.end, delta);
        } else if (role === 'resize-r') {
          it.durationMode = 'end'; it.end = addDays(orig.end, delta); if (it.end < it.start) it.end = it.start;
        } else {
          it.durationMode = 'end'; it.end = orig.end; it.start = addDays(orig.start, delta); if (it.start > it.end) it.start = it.end;
        }
      }, false, `drag:${id}`);
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-bar'); store.breakCoalesce();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
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
      renderPreview(); syncRows(); updateUndo();
      const t = side.querySelector('.proj.active .proj-title');
      if (t) t.textContent = P().title || 'Untitled';
    }
  });
  applyLayoutClasses();
  refreshAll();
}
