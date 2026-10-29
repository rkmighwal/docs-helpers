import { h, pickFile, toast } from './dom';
import { store } from '../store';
import { HolidayList, Theme, ThemeColors, clone, sampleProject, uid } from '../model';
import { BUILTIN_THEMES, THEME_COLOR_LABELS, themeById, validateTheme } from '../themes';
import { TEMPLATES, Template, applyTemplate } from '../templates';
import { download, readFileText, slug } from '../export';
import { renderPlan } from '../render';
import { Holiday, addHoliday, duplicateDates, mergeHolidays, parseHolidayText, removeHoliday, sortHolidays, updateHoliday, weekdayName } from '../holidays';
import { parse } from '../dates';
import { DEFAULT_IMPORT, ImportOptions, TbFile, applyTimelineImport, describeImport, parseTimelineFile } from '../tbimport';
import { APP, copyrightLine, formatReleaseDate } from '../about';

export function modal(title: string, body: HTMLElement, wide = true): { close: () => void } {
  const dlg = h('dialog', { class: 'modal' + (wide ? '' : ' narrow-modal') });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn', onclick: close }, 'Close')), body);
  dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0));
  document.body.append(dlg);
  dlg.showModal();
  return { close };
}

/** Put a rendered SVG into a container so it scales to the container's width. */
export function fitSvg(el: HTMLElement, svg: string) {
  el.innerHTML = svg;
  const s = el.querySelector('svg');
  if (!s) return;
  s.removeAttribute('width'); s.removeAttribute('height');
  s.style.width = '100%'; s.style.height = 'auto'; s.style.display = 'block';
}

/* ---------- Holiday lists ---------- */

export function openHolidayDialog() {
  let sel: string | null = store.lib.holidayLists[0]?.id ?? null;
  let draftDate = '', draftName = ''; // the quick-add line keeps what was typed while the rest of the dialog redraws
  let pasteOpen = false;
  let saveTimer: number | undefined;
  const attach = (id: string, on: boolean) => store.mutate(p => {
    p.holidayListIds = on ? [...new Set([...p.holidayListIds, id])] : p.holidayListIds.filter(x => x !== id);
  }, true);
  const current = () => store.lib.holidayLists.find(l => l.id === sel);
  /** The saved list, in date order. Handlers read this, not the list captured when the dialog was drawn, so a rename that is still being saved is never overwritten. */
  const live = (): Holiday[] => sortHolidays(current()?.holidays ?? []);
  const save = (holidays: Holiday[]) => { const l = current(); if (l) store.upsertHolidayList({ ...l, holidays }); };
  const root = h('div', { class: 'dlg-body' });

  const render = () => {
    window.clearTimeout(saveTimer);
    root.replaceChildren();
    const lists = store.lib.holidayLists;
    const cur = current();
    const proj = store.active();

    const importFile = async () => {
      const f = await pickFile('.json,.csv,.txt'); if (!f) return;
      try {
        const text = await readFileText(f);
        let l: HolidayList;
        try {
          const j = JSON.parse(text);
          l = { id: uid(), name: j.name || f.name.replace(/\.\w+$/, ''), holidays: sortHolidays(parseHolidayText((j.holidays ?? []).map((x: any) => `${x.date},${x.name ?? ''}`).join('\n')).holidays) };
        } catch {
          l = { id: uid(), name: f.name.replace(/\.\w+$/, ''), holidays: sortHolidays(parseHolidayText(text).holidays) };
        }
        store.upsertHolidayList(l); attach(l.id, true); sel = l.id; render(); toast(`Imported ${l.holidays.length} holidays and added the list to this project`);
      } catch (e: any) { toast(e.message, 'error'); }
    };

    const listCol = h('div', { class: 'dlg-col narrow' },
      h('p', { class: 'hint' }, 'Holiday lists are shared: attach any list to any project from its settings. Holidays are not working days, so they carry no load.'),
      ...lists.map(l => h('div', { class: 'list-item' + (l.id === sel ? ' active' : ''), onclick: () => { sel = l.id; render(); } },
        l.name, h('small', {}, `${l.holidays.length} day${l.holidays.length === 1 ? '' : 's'}${proj.holidayListIds.includes(l.id) ? ' · in use' : ''}`))),
      h('button', { class: 'btn primary', onclick: () => {
        const l: HolidayList = { id: uid(), name: 'New holiday list', holidays: [] };
        store.upsertHolidayList(l); attach(l.id, true); sel = l.id; render();
      } }, '+ New list'),
      h('button', { class: 'btn', onclick: importFile }, 'Import file…'));

    const editCol = h('div', { class: 'dlg-col' });
    if (!cur) {
      editCol.append(h('p', { class: 'hint' }, 'Create or select a holiday list.'));
      root.append(listCol, editCol);
      return;
    }

    const holidays = sortHolidays(cur.holidays);
    const dupes = duplicateDates(holidays);

    // quick add: pick the date in the calendar, type the name, press Add (or Enter)
    const dateIn = h('input', { type: 'date', class: 'hdate', value: draftDate, title: 'Pick the date in the calendar', oninput: (e: Event) => { draftDate = (e.target as HTMLInputElement).value; } }) as HTMLInputElement;
    const nameIn = h('input', { type: 'text', class: 'hname', value: draftName, placeholder: 'Holiday name, e.g. Republic Day', oninput: (e: Event) => { draftName = (e.target as HTMLInputElement).value; },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } }) as HTMLInputElement;
    const add = () => {
      const r = addHoliday(live(), dateIn.value, nameIn.value);
      if (r.error) { toast(r.error, 'error'); (dateIn.value ? nameIn : dateIn).focus(); return; }
      draftName = ''; // the date stays, so the next one in the same month is quick to pick
      save(r.list); render();
      (root.querySelector('.hname') as HTMLInputElement | null)?.focus();
    };
    const quickAdd = h('div', { class: 'hadd' }, dateIn, nameIn, h('button', { class: 'btn primary', onclick: add }, '+ Add holiday'));

    // one holiday per row
    const rows = holidays.map((hd, i) => {
      const wd = weekdayName(hd.date);
      const off = !proj.workDays.includes(parse(hd.date).getUTCDay());
      const dateInput = h('input', { type: 'date', class: 'hdate', value: hd.date, title: 'Change the date',
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          const r = v ? updateHoliday(live(), i, { date: v }) : { list: live(), error: 'A holiday needs a date.' };
          if (r.error) { toast(r.error, 'error'); render(); return; }
          save(r.list); render();
        } });
      const nameInput = h('input', { type: 'text', class: 'hname', value: hd.name, placeholder: 'Holiday name',
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => { const r = updateHoliday(sortHolidays(current()?.holidays ?? []), i, { name: v }); if (!r.error) save(r.list); }, 300);
        } });
      return h('div', { class: 'hrow' + (dupes.has(hd.date) ? ' dupe' : '') },
        dateInput,
        h('span', { class: 'hday' + (off ? ' off' : ''), title: off ? 'This day is not a working day in the current project anyway' : '' }, wd),
        nameInput,
        dupes.has(hd.date) ? h('span', { class: 'hwarn', title: 'Another holiday is on this date; only the first one is used' }, '⚠') : h('span'),
        h('button', { class: 'btn tiny danger', title: 'Remove this holiday', onclick: () => { window.clearTimeout(saveTimer); save(removeHoliday(live(), i)); render(); } }, '✕'));
    });

    const years = [...new Set(holidays.map(x => x.date.slice(0, 4)))];
    const info = h('div', { class: 'hint' }, holidays.length
      ? `${holidays.length} holiday${holidays.length === 1 ? '' : 's'}${years.length ? ` · ${years.join(', ')}` : ''} · saved automatically`
      : 'No holidays yet. Pick a date and type a name above, then press Add.');

    const pasteArea = h('textarea', { rows: 6, spellcheck: 'false', placeholder: '2026-01-26, Republic Day\n2026-12-25, Christmas' }) as HTMLTextAreaElement;
    const pasteInfo = h('span', { class: 'hint' });
    pasteArea.addEventListener('input', () => { const p = parseHolidayText(pasteArea.value); pasteInfo.textContent = `${p.holidays.length} valid line${p.holidays.length === 1 ? '' : 's'}${p.bad ? ` · ${p.bad} ignored (use YYYY-MM-DD, Name)` : ''}`; });
    const paste = h('div', { class: 'hpaste' },
      h('p', { class: 'hint' }, 'One per line: YYYY-MM-DD, Name. Dates that are already in the list are skipped.'), pasteArea,
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => {
        const p = parseHolidayText(pasteArea.value);
        if (!p.holidays.length) { toast('Nothing to add: use lines like 2026-01-26, Republic Day', 'error'); return; }
        const m = mergeHolidays(live(), p.holidays);
        save(m.list); pasteOpen = false; render();
        toast(`Added ${m.added} holiday${m.added === 1 ? '' : 's'}${m.skipped ? `, skipped ${m.skipped} already in the list` : ''}`);
      } }, 'Add these'), pasteInfo));

    editCol.append(
      h('label', { class: 'field' }, 'List name', h('input', { type: 'text', value: cur.name, onchange: (e: Event) => {
        store.upsertHolidayList({ ...cur, name: (e.target as HTMLInputElement).value || 'Holidays' }); render();
      } })),
      h('label', { class: 'check use-list' }, h('input', { type: 'checkbox', checked: proj.holidayListIds.includes(cur.id), onchange: (e: Event) => { attach(cur.id, (e.target as HTMLInputElement).checked); render(); } }),
        `Use this list in the current project: “${proj.title || 'Untitled'}”`),
      proj.useDates ? '' : h('p', { class: 'hint' }, 'This project has no calendar dates, so holidays are ignored until you switch it to calendar dates.'),
      h('div', { class: 'subhead' }, 'Add a holiday'),
      quickAdd,
      h('div', { class: 'subhead' }, 'Holidays in this list'),
      holidays.length ? h('div', { class: 'hrows' }, ...rows) : h('p', { class: 'empty' }, 'Nothing here yet.'),
      info,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => { pasteOpen = !pasteOpen; render(); } }, pasteOpen ? 'Hide paste box' : 'Paste several at once…'),
        h('button', { class: 'btn small', onclick: () => download(`${slug(cur.name)}-holidays.json`, JSON.stringify({ name: cur.name, holidays: live() }, null, 2), 'application/json') }, 'Export JSON'),
        h('button', { class: 'btn small danger', onclick: () => {
          if (confirm(`Delete "${cur.name}"? It will be detached from all projects.`)) { store.removeHolidayList(cur.id); sel = store.lib.holidayLists[0]?.id ?? null; render(); }
        } }, 'Delete list')),
      pasteOpen ? paste : '');
    root.append(listCol, editCol);
  };
  render();
  modal('Public holiday lists', root);
}

/* ---------- Themes ---------- */

export function openThemeDialog() {
  const proj = store.active();
  let draft: Theme = clone(store.themeFor(proj));
  const root = h('div', { class: 'dlg-body' });
  const preview = h('div', { class: 'theme-preview' });
  const updatePreview = () => fitSvg(preview, renderPlan(clone(proj), draft, store.holidayDates(proj), { interactive: false }).svg);

  const render = () => {
    root.replaceChildren();
    const themeSel = h('select', { onchange: (e: Event) => {
      draft = clone(store.allThemes().find(x => x.id === (e.target as HTMLSelectElement).value)!); render();
    } }, ...store.allThemes().map(t => h('option', { value: t.id, selected: t.id === draft.id }, t.name + (t.builtin ? '' : ' (custom)'))));
    const isCustom = !draft.builtin && store.lib.customThemes.some(t => t.id === draft.id);
    const colors = h('div', { class: 'color-grid' }, ...(Object.keys(THEME_COLOR_LABELS) as (keyof ThemeColors)[]).map(k =>
      h('label', { class: 'color' },
        h('input', { type: 'color', value: draft.colors[k], oninput: (e: Event) => { draft.colors[k] = (e.target as HTMLInputElement).value; updatePreview(); } }),
        THEME_COLOR_LABELS[k])));
    const left = h('div', { class: 'dlg-col narrow2' },
      h('label', { class: 'field' }, 'Theme', themeSel),
      h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: draft.name, oninput: (e: Event) => { draft.name = (e.target as HTMLInputElement).value; } })),
      colors,
      h('label', { class: 'field' }, 'Font family', h('input', { type: 'text', value: draft.fontFamily, oninput: (e: Event) => { draft.fontFamily = (e.target as HTMLInputElement).value; updatePreview(); } })),
      h('label', { class: 'field' }, 'Font size (9–20)', h('input', { type: 'number', min: 9, max: 20, value: draft.fontSize, oninput: (e: Event) => {
        draft.fontSize = Math.min(20, Math.max(9, Number((e.target as HTMLInputElement).value) || 12)); updatePreview();
      } })),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => {
          const t: Theme = { ...clone(draft), id: 'custom-' + uid(), builtin: false, name: draft.name || 'My theme' };
          store.upsertTheme(t); store.mutate(p => { p.themeId = t.id; p.templateId = ''; }, true); draft = t; toast('Saved as new theme'); render();
        } }, 'Save as new theme'),
        isCustom && h('button', { class: 'btn', onclick: () => { store.upsertTheme(clone(draft)); toast('Theme updated'); } }, 'Update this theme'),
        h('button', { class: 'btn', onclick: () => {
          const known = BUILTIN_THEMES.some(b => b.id === draft.id) || isCustom;
          if (!known) { toast('Save it as a new theme first', 'error'); return; }
          store.mutate(p => { p.themeId = draft.id; }, true); toast('Applied to project');
        } }, 'Apply to project'),
        h('button', { class: 'btn', onclick: () => download(`${slug(draft.name)}.theme.json`, JSON.stringify({ ...draft, builtin: undefined }, null, 2), 'application/json') }, 'Export theme'),
        h('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('.json'); if (!f) return;
          try {
            const t = validateTheme(JSON.parse(await readFileText(f)));
            if (!t) throw new Error('Not a valid theme file.');
            t.id = 'custom-' + uid(); store.upsertTheme(t); draft = clone(t); toast(`Imported "${t.name}"`); render();
          } catch (e: any) { toast(e.message, 'error'); }
        } }, 'Import theme'),
        isCustom && h('button', { class: 'btn danger', onclick: () => {
          if (confirm(`Delete theme "${draft.name}"?`)) { store.removeTheme(draft.id); draft = clone(BUILTIN_THEMES[0]); render(); }
        } }, 'Delete')),
      h('p', { class: 'hint' }, 'Colours, font and size live here. Borders, cell style and layout are set under “Look & borders” or by choosing a template.'));
    root.append(left, h('div', { class: 'dlg-col' }, h('p', { class: 'hint' }, 'Live preview (current project)'), preview));
    updatePreview();
  };
  render();
  modal('Themes', root);
}

/* ---------- Templates ---------- */

function sampleForTemplate(): ReturnType<typeof sampleProject> {
  const p = sampleProject();
  p.periods = 6; p.title = 'Platform Migration'; p.subtitle = 'Resource loading plan';
  p.allocations = p.allocations.slice(0, 8);
  p.view.showLegend = false; p.view.showSkillSummary = false; p.view.showCapacity = false; p.view.showGap = false;
  return p;
}

export function openTemplateDialog() {
  const proj = store.active();
  const grid = h('div', { class: 'tpl-grid' });
  let dlg: { close: () => void } | null = null;
  const choose = (t: Template) => {
    store.mutate(p => applyTemplate(p, t), true);
    toast(`Applied “${t.name}”`);
    dlg?.close();
  };
  for (const t of TEMPLATES) {
    const p = sampleForTemplate();
    applyTemplate(p, t);
    const thumb = h('div', { class: 'tpl-thumb' });
    fitSvg(thumb, renderPlan(p, themeById(p.themeId, store.lib.customThemes), [], { interactive: false }).svg);
    grid.append(h('div', { class: 'tpl-card' + (proj.templateId === t.id ? ' active' : '') },
      thumb,
      h('div', { class: 'tpl-meta' }, h('strong', {}, t.name), h('small', {}, `Inspired by: ${t.inspiredBy}`)),
      h('button', { class: 'btn primary small', onclick: () => choose(t) }, proj.templateId === t.id ? 'Re-apply' : 'Use this template')));
  }
  dlg = modal('Templates', h('div', { class: 'tpl-body' },
    h('p', { class: 'hint' }, 'A template sets the theme and the table style (borders, cell display, header and group look). Your rows, grouping and the columns you chose to show are kept. Fine-tune afterwards under “Look & borders”.'),
    grid));
}

/* ---------- Import from Timeline Builder ---------- */

export function openTimelineImportDialog() {
  const root = h('div', { class: 'import-body' });
  let file: TbFile | null = null;
  let fileName = '';
  let which = 0;
  let opts: ImportOptions = { ...DEFAULT_IMPORT };
  let dlgRef: { close: () => void } | null = null;

  const choose = async () => {
    const f = await pickFile('.json,application/json'); if (!f) return;
    try { file = parseTimelineFile(await readFileText(f)); fileName = f.name; which = 0; render(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const check = (label: string, key: keyof ImportOptions, hint?: string, disabled = false) =>
    h('label', { class: 'check block' }, h('input', { type: 'checkbox', checked: opts[key], disabled, onchange: (e: Event) => { (opts as any)[key] = (e.target as HTMLInputElement).checked; render(); } }),
      h('span', {}, label, hint && h('small', { class: 'fhint' }, hint)));

  const run = () => {
    if (!file) return;
    const src = file.projects[which];
    const p = store.active();
    // copy the timeline's holiday lists into the library (reusing identical ones) and attach them
    const attach: string[] = [];
    if (opts.holidays) {
      for (const l of src.holidayLists) {
        const same = store.lib.holidayLists.find(x => x.name === l.name && JSON.stringify(x.holidays) === JSON.stringify(l.holidays));
        if (same) { attach.push(same.id); continue; }
        const copy = { ...l, id: uid() };
        store.upsertHolidayList(copy); attach.push(copy.id);
      }
    }
    let summary = { tasks: 0, workstreams: 0, loads: 0, holidayLists: 0, timeline: false };
    store.mutate(q => { summary = applyTimelineImport(q, src, opts, attach); }, true);
    const bits = [`${summary.tasks} task${summary.tasks === 1 ? '' : 's'}`];
    if (summary.workstreams) bits.push(`${summary.workstreams} new work stream${summary.workstreams === 1 ? '' : 's'}`);
    if (summary.loads) bits.push(`${summary.loads} resource line${summary.loads === 1 ? '' : 's'} to fill in`);
    if (summary.timeline) bits.push('timeline settings');
    toast(`Imported ${bits.join(', ')} into “${p.title}”`);
    dlgRef?.close();
  };

  const render = () => {
    root.replaceChildren();
    root.append(h('p', {}, 'Bring the tasks and the timeline from a ', h('strong', {}, 'Timeline Builder'), ' project into this plan. In Timeline Builder use ',
      h('em', {}, 'File ▸ Save project as JSON'), ' and pick that file here.'));
    root.append(h('div', { class: 'row' },
      h('button', { class: 'btn' + (file ? '' : ' primary'), onclick: choose }, file ? 'Choose another file…' : 'Choose Timeline Builder JSON…'),
      file && h('span', { class: 'hint' }, fileName)));
    if (!file) return;
    if (file.projects.length > 1) {
      root.append(h('label', { class: 'field' }, 'The file contains several projects — import which one?',
        h('select', { onchange: (e: Event) => { which = Number((e.target as HTMLSelectElement).value); render(); } },
          ...file.projects.map((q, i) => h('option', { value: i, selected: i === which }, q.title)))));
    }
    const src = file.projects[which];
    const d = describeImport(src);
    const p = store.active();
    const mismatch = src.useDates !== p.useDates;
    root.append(
      h('div', { class: 'import-sum' },
        h('strong', {}, src.title), h('span', {}, ` — ${d.tasks} tasks & phases, ${d.milestones} milestones/gates, ${src.useDates ? `${src.scale}ly, from ${src.startDate}` : `relative ${src.scale}s (no dates)`}, ${src.holidayLists.length} holiday list${src.holidayLists.length === 1 ? '' : 's'}`)),
      h('div', { class: 'subhead' }, 'What to import'),
      check('Tasks and phases', 'tasks', `${d.tasks} items become tasks you can attach resources to`),
      check('Milestones and gates too', 'milestones', `${d.milestones} single-day markers`, !opts.tasks),
      check('Make a work stream for each phase', 'workstreamsFromPhases', `${d.phases} top-level phase${d.phases === 1 ? '' : 's'}; their tasks are filed under them`, !opts.tasks),
      check('Timeline settings', 'applyTimeline', mismatch ? 'Required: this timeline is ' + (src.useDates ? 'dated' : 'relative') + ' and the project is not' : 'Grain, start, number of columns and working days', mismatch),
      check('Holiday lists', 'holidays', `${src.holidayLists.length} list${src.holidayLists.length === 1 ? '' : 's'} used by the timeline`, !src.useDates || !src.holidayLists.length),
      h('div', { class: 'subhead' }, 'How'),
      check('Replace the tasks already in this project', 'replace', 'Off = add to them. Resource lines linked to replaced tasks keep their dates', !opts.tasks),
      check('Add a resource line for each task', 'createLoads', '1 person, skill left blank — fill in the skill and number afterwards', !opts.tasks),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: run }, `Import into “${p.title || 'this project'}”`)),
      h('p', { class: 'hint' }, 'You can undo an import with Ctrl/Cmd+Z.'));
  };
  render();
  dlgRef = modal('Import from Timeline Builder', root, false);
}

/* ---------- Export: what to do about cost ---------- */

/**
 * Shown when cost calculations are in use: lets the user leave cost out of an export.
 * `sheet` / `rows` are offered only when given (an Excel export offers both, an image only the rows).
 */
export function openCostExportDialog(o: { title: string; sheet: boolean; rows: boolean }, go: (r: { sheet: boolean; rows: boolean }) => void) {
  const c = store.active().cost;
  const pick = { sheet: c.exportSheet, rows: c.exportRows };
  const box = (label: string, hint: string, key: 'sheet' | 'rows') =>
    h('label', { class: 'check block' }, h('input', { type: 'checkbox', checked: pick[key], onchange: (e: Event) => { pick[key] = (e.target as HTMLInputElement).checked; } }), h('span', {}, label, h('small', { class: 'fhint' }, hint)));
  let dlg: { close: () => void } | null = null;
  dlg = modal(o.title, h('div', { class: 'import-body' },
    h('p', {}, 'Cost calculations are in use in this project. Untick anything that should ', h('strong', {}, 'not'), ' be in this export.'),
    o.sheet ? box('Cost sheet', 'A separate sheet with the rates, person-months and cost per period — and the cost-per-day column of the Resources sheet.', 'sheet') : null,
    o.rows ? box('Cost rows in the table', 'The Cost section of the table: cost per group, total cost and effort in person-months.', 'rows') : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => {
        // remember the choice for next time
        store.mutate(q => { if (o.sheet) q.cost.exportSheet = pick.sheet; if (o.rows) q.cost.exportRows = pick.rows; }, true);
        dlg?.close();
        go({ sheet: o.sheet && pick.sheet, rows: o.rows && pick.rows });
      } }, 'Export'),
      h('button', { class: 'btn', onclick: () => dlg?.close() }, 'Cancel')),
    h('p', { class: 'hint' }, 'Your choice is remembered. You can also switch cost on or off, and hide it from the table, in the Cost section of the editor.')), false);
}

/* ---------- About / licence ---------- */

export function openLicenseDialog() {
  const body = h('div', { class: 'license-body' },
    h('dl', { class: 'about-meta' },
      h('dt', {}, 'Product'), h('dd', {}, APP.name),
      h('dt', {}, 'Version'), h('dd', {}, APP.version),
      h('dt', {}, 'Published'), h('dd', {}, formatReleaseDate(APP.releaseDate)),
      h('dt', {}, 'License'), h('dd', {}, APP.licenseId),
      copyrightLine() && h('dt', {}, 'Copyright'), copyrightLine() && h('dd', {}, copyrightLine().replace(/^copyright\s*(\(c\)\s*)?/i, ''))),
    h('p', { class: 'hint' }, 'Runs entirely in your browser. Your projects stay on this device and nothing is sent anywhere.'),
    h('div', { class: 'subhead' }, 'Full license text'),
    h('pre', { class: 'license-text' }, APP.licenseText));
  modal(`${APP.licenseId} License`, body);
}

