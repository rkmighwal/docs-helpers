import { h, pickFile, toast } from './dom';
import { store } from '../store';
import { HolidayList, Theme, ThemeColors, clone, sampleProject, uid } from '../model';
import { BUILTIN_THEMES, THEME_COLOR_LABELS, themeById, validateTheme } from '../themes';
import { TEMPLATES, Template, applyTemplate } from '../templates';
import { download, readFileText, slug } from '../export';
import { renderPlan } from '../render';
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

export function parseHolidayText(text: string): { holidays: { date: string; name: string }[]; bad: number } {
  const holidays: { date: string; name: string }[] = [];
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*[,;\t ]?\s*(.*)$/);
    if (m && !isNaN(Date.parse(m[1]))) holidays.push({ date: m[1], name: m[2].replace(/^"|"$/g, '') });
    else bad++;
  }
  return { holidays, bad };
}

export function openHolidayDialog() {
  let sel: string | null = store.lib.holidayLists[0]?.id ?? null;
  const attach = (id: string, on: boolean) => store.mutate(p => {
    p.holidayListIds = on ? [...new Set([...p.holidayListIds, id])] : p.holidayListIds.filter(x => x !== id);
  }, true);
  const root = h('div', { class: 'dlg-body' });
  const render = () => {
    root.replaceChildren();
    const lists = store.lib.holidayLists;
    const cur = lists.find(l => l.id === sel);
    const listCol = h('div', { class: 'dlg-col narrow' },
      h('p', { class: 'hint' }, 'Holiday lists are shared: attach any list to any project from its Timeline settings. Holidays are not working days, so they carry no load.'),
      ...lists.map(l => h('div', { class: 'list-item' + (l.id === sel ? ' active' : ''), onclick: () => { sel = l.id; render(); } },
        l.name, h('small', {}, `${l.holidays.length} days${store.active().holidayListIds.includes(l.id) ? ' · in use' : ''}`))),
      h('button', { class: 'btn primary', onclick: () => {
        const l: HolidayList = { id: uid(), name: 'New holiday list', holidays: [] };
        store.upsertHolidayList(l); attach(l.id, true); sel = l.id; render();
      } }, '+ New list'),
      h('button', { class: 'btn', onclick: async () => {
        const f = await pickFile('.json,.csv,.txt'); if (!f) return;
        try {
          const text = await readFileText(f);
          let l: HolidayList;
          try {
            const j = JSON.parse(text);
            l = { id: uid(), name: j.name || f.name.replace(/\.\w+$/, ''), holidays: parseHolidayText((j.holidays ?? []).map((x: any) => `${x.date},${x.name ?? ''}`).join('\n')).holidays };
          } catch {
            l = { id: uid(), name: f.name.replace(/\.\w+$/, ''), holidays: parseHolidayText(text).holidays };
          }
          store.upsertHolidayList(l); attach(l.id, true); sel = l.id; render(); toast(`Imported ${l.holidays.length} holidays and added the list to this project`);
        } catch (e: any) { toast(e.message, 'error'); }
      } }, 'Import file…'));
    const editCol = h('div', { class: 'dlg-col' });
    if (!cur) editCol.append(h('p', { class: 'hint' }, 'Create or select a holiday list.'));
    else {
      const info = h('span', { class: 'hint' });
      const ta = h('textarea', { rows: 16, spellcheck: 'false', placeholder: '2026-01-26, Republic Day\n2026-12-25, Christmas' }) as HTMLTextAreaElement;
      ta.value = cur.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)).map(x => `${x.date}, ${x.name}`).join('\n');
      const apply = () => {
        const { holidays, bad } = parseHolidayText(ta.value);
        info.textContent = `${holidays.length} valid dates` + (bad ? ` · ${bad} line(s) ignored (use YYYY-MM-DD, Name)` : '');
        return holidays;
      };
      apply();
      let timer: number | undefined;
      ta.addEventListener('input', () => {
        const holidays = apply();
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const l = store.lib.holidayLists.find(x => x.id === cur.id); if (!l) return;
          store.upsertHolidayList({ ...l, holidays });
          const small = root.querySelector('.list-item.active small'); if (small) small.textContent = `${holidays.length} days${store.active().holidayListIds.includes(l.id) ? ' · in use' : ''}`;
        }, 400);
      });
      const proj = store.active();
      editCol.append(
        h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: cur.name, onchange: (e: Event) => {
          store.upsertHolidayList({ ...cur, name: (e.target as HTMLInputElement).value || 'Holidays' }); render();
        } })),
        h('label', { class: 'check use-list' }, h('input', { type: 'checkbox', checked: proj.holidayListIds.includes(cur.id), onchange: (e: Event) => { attach(cur.id, (e.target as HTMLInputElement).checked); render(); } }),
          `Use this list in the current project: “${proj.title || 'Untitled'}”`),
        proj.useDates ? '' : h('p', { class: 'hint' }, 'This project has no calendar dates, so holidays are ignored until you switch it to calendar dates.'),
        h('label', { class: 'field' }, 'Dates — one per line: YYYY-MM-DD, Name (saved automatically)', ta),
        info,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { store.upsertHolidayList({ ...cur, holidays: apply() }); toast('Holiday list saved'); render(); } }, 'Save now'),
          h('button', { class: 'btn', onclick: () => download(`${slug(cur.name)}-holidays.json`, JSON.stringify({ name: cur.name, holidays: cur.holidays }, null, 2), 'application/json') }, 'Export JSON'),
          h('button', { class: 'btn danger', onclick: () => {
            if (confirm(`Delete "${cur.name}"? It will be detached from all projects.`)) { store.removeHolidayList(cur.id); sel = store.lib.holidayLists[0]?.id ?? null; render(); }
          } }, 'Delete')));
    }
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

