import { h, pickFile, toast } from './dom';
import { store } from '../store';
import { HolidayList, Theme, clone, recalcItem, sampleProject, uid } from '../model';
import { BUILTIN_THEMES, THEME_COLOR_LABELS, themeById, validateTheme } from '../themes';
import { TEMPLATES, Template, applyTemplate } from '../templates';
import { download, readFileText, slug } from '../export';
import { renderTimeline } from '../render';
import { Holiday, addHoliday, duplicateDates, mergeHolidays, parseHolidayText, removeHoliday, sortHolidays, updateHoliday, weekdayName } from '../holidays';
import { parse, workDaysOf } from '../dates';
import { APP, copyrightLine, formatReleaseDate } from '../about';

function modal(title: string, body: HTMLElement): { close: () => void } {
  const dlg = h('dialog', { class: 'modal' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn', onclick: close }, 'Close')), body);
  dlg.addEventListener('cancel', () => setTimeout(() => dlg.remove(), 0));
  document.body.append(dlg);
  dlg.showModal();
  return { close };
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
      h('p', { class: 'hint' }, 'Holiday lists are shared: attach any list to any project from its settings. Holidays are skipped when counting working days and shown on the chart.'),
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
      const off = workDaysOf(proj.weekendDays).indexOf(parse(hd.date).getUTCDay()) < 0;
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

/* ---------- Themes (colours and font) ---------- */

export function openThemeDialog() {
  const proj = store.active();
  let draft: Theme = clone(store.themeFor(proj));
  const root = h('div', { class: 'dlg-body' });
  const preview = h('div', { class: 'theme-preview' });

  const updatePreview = () => {
    const r = renderTimeline(clone(proj), draft, { interactive: false, holidays: store.holidaysFor(proj) });
    preview.innerHTML = r.svg;
    const svg = preview.querySelector('svg')!;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = '100%'; svg.style.height = 'auto';
  };

  const render = () => {
    root.replaceChildren();
    const themeSel = h('select', { onchange: (e: Event) => {
      const t = store.allThemes().find(x => x.id === (e.target as HTMLSelectElement).value)!;
      draft = clone(t); render();
    } }, ...store.allThemes().map(t => h('option', { value: t.id, selected: t.id === draft.id }, t.name + (t.builtin ? '' : ' (custom)'))));
    const isCustom = !draft.builtin && store.lib.customThemes.some(t => t.id === draft.id);

    const colors = h('div', { class: 'color-grid' }, ...(Object.keys(THEME_COLOR_LABELS) as (keyof Theme['colors'])[]).map(k =>
      h('label', { class: 'color' },
        h('input', { type: 'color', value: draft.colors[k], oninput: (e: Event) => { draft.colors[k] = (e.target as HTMLInputElement).value; updatePreview(); } }),
        THEME_COLOR_LABELS[k])));
    const left = h('div', { class: 'dlg-col narrow2' },
      h('label', { class: 'field' }, 'Theme', themeSel),
      h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: draft.name, oninput: (e: Event) => { draft.name = (e.target as HTMLInputElement).value; } })),
      colors,
      h('label', { class: 'field' }, 'Font family', h('input', { type: 'text', value: draft.fontFamily, oninput: (e: Event) => { draft.fontFamily = (e.target as HTMLInputElement).value; updatePreview(); } })),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => {
          const t: Theme = { ...clone(draft), id: 'custom-' + uid(), builtin: false, name: draft.name || 'My theme' };
          store.upsertTheme(t); store.mutate(p => { p.themeId = t.id; }, true); draft = t; toast('Saved as new theme'); render();
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
      h('p', { class: 'hint' }, 'A theme is the colours and the font. The look of the bars, header, title and rows is a template — choose one under “Templates”, then fine-tune it in the “Layout & style” section. Exported .theme.json files can be shared and loaded with “Import theme”.'));
    root.append(left, h('div', { class: 'dlg-col' }, h('p', { class: 'hint' }, 'Live preview (current project)'), preview));
    updatePreview();
  };
  render();
  modal('Themes', root);
}

/* ---------- Templates (layouts) ---------- */

/** A small, representative chart for the template gallery. */
function thumbnailProject(t: Template) {
  const p = sampleProject();
  p.periods = 8; p.title = 'Website Relaunch'; p.subtitle = 'Delivery plan'; p.showToday = false;
  p.legend.show = false; p.footerText = '';
  // a fresh sample has no end dates yet: work them out from the working days, as the app does for every project
  p.items.forEach(i => recalcItem(i, { weekend: p.weekendDays, holidays: new Set() }));
  applyTemplate(p, t);
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
    const p = thumbnailProject(t);
    const thumb = h('div', { class: 'tpl-thumb' });
    thumb.innerHTML = renderTimeline(p, themeById(p.themeId, store.lib.customThemes), { interactive: false, holidays: [] }).svg;
    const svg = thumb.querySelector('svg')!;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
    grid.append(h('div', { class: 'tpl-card' + (proj.templateId === t.id ? ' active' : '') },
      thumb,
      h('div', { class: 'tpl-meta' }, h('strong', {}, t.name), h('small', {}, `Inspired by: ${t.inspiredBy}`)),
      h('button', { class: 'btn primary small', onclick: () => choose(t) }, proj.templateId === t.id ? 'Re-apply' : 'Use this template')));
  }
  dlg = modal('Templates', h('div', { class: 'tpl-body' },
    h('p', { class: 'hint' }, 'A template sets the layout (row height, bar and header style, title, frame, markers…) and switches the project to the colour theme it was designed with. Your items and timeline settings are kept. Change the colours afterwards under “Themes”, and fine-tune the layout in the “Layout & style” section.'),
    grid));
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
