import { h, pickFile, toast } from './dom';
import { store } from '../store';
import { HolidayList, Theme, uid } from '../model';
import { BUILTIN_THEMES, THEME_COLOR_LABELS, validateTheme } from '../themes';
import { download, readFileText, slug } from '../export';
import { renderTimeline } from '../render';
import { SHAPES, ShapeId } from '../shapes';
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
      h('p', { class: 'hint' }, 'Holiday lists are shared: attach any list to any project from its settings.'),
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
        // save as you type so the chart and working-day calculations always use the latest dates
        timer = window.setTimeout(() => { const l = store.lib.holidayLists.find(x => x.id === cur.id); if (!l) return; store.upsertHolidayList({ ...l, holidays });
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
  let draft: Theme = JSON.parse(JSON.stringify(store.themeFor(proj)));
  const root = h('div', { class: 'dlg-body' });
  const preview = h('div', { class: 'theme-preview' });

  const updatePreview = () => {
    const p = JSON.parse(JSON.stringify(proj));
    const r = renderTimeline(p, draft, { interactive: false, holidays: store.holidaysFor(proj) });
    preview.innerHTML = r.svg;
    const svg = preview.querySelector('svg')!;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = '100%'; svg.style.height = 'auto';
  };

  const render = () => {
    root.replaceChildren();
    const themeSel = h('select', { onchange: (e: Event) => {
      const t = store.allThemes().find(x => x.id === (e.target as HTMLSelectElement).value)!;
      draft = JSON.parse(JSON.stringify(t)); render();
    } }, ...store.allThemes().map(t => h('option', { value: t.id, selected: t.id === draft.id }, t.name + (t.builtin ? '' : ' (custom)'))));
    const isCustom = !draft.builtin && store.lib.customThemes.some(t => t.id === draft.id);

    const colors = h('div', { class: 'color-grid' }, ...(Object.keys(THEME_COLOR_LABELS) as (keyof Theme['colors'])[]).map(k =>
      h('label', { class: 'color' },
        h('input', { type: 'color', value: draft.colors[k], oninput: (e: Event) => { draft.colors[k] = (e.target as HTMLInputElement).value; updatePreview(); } }),
        THEME_COLOR_LABELS[k])));
    const num = (label: string, key: 'rowHeight' | 'barHeight' | 'barRadius', min: number, max: number) =>
      h('label', { class: 'field' }, `${label} (${min}–${max})`, h('input', { type: 'number', min, max, value: draft[key], oninput: (e: Event) => {
        draft[key] = Math.min(max, Math.max(min, Number((e.target as HTMLInputElement).value) || min)); updatePreview();
      } }));
    const dsel = (label: string, key: keyof Theme['design'], opts: [string, string][]) =>
      h('label', { class: 'field' }, label, h('select', { onchange: (e: Event) => { (draft.design as any)[key] = (e.target as HTMLSelectElement).value as ShapeId; updatePreview(); } },
        ...opts.map(([v, l]) => h('option', { value: v, selected: (draft.design as any)[key] === v }, l))));
    const dopt = (label: string, key: 'highlight' | 'doneColor' | 'gradientTo', def: string) =>
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!draft.design[key], onchange: (e: Event) => { draft.design[key] = (e.target as HTMLInputElement).checked ? def : ''; updatePreview(); render(); } }), label,
        draft.design[key] && h('input', { type: 'color', value: draft.design[key], oninput: (e: Event) => { draft.design[key] = (e.target as HTMLInputElement).value; updatePreview(); } }));
    const left = h('div', { class: 'dlg-col narrow2' },
      h('label', { class: 'field' }, 'Design', themeSel),
      h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: draft.name, oninput: (e: Event) => { draft.name = (e.target as HTMLInputElement).value; } })),
      colors,
      h('label', { class: 'field' }, 'Font family', h('input', { type: 'text', value: draft.fontFamily, oninput: (e: Event) => { draft.fontFamily = (e.target as HTMLInputElement).value; updatePreview(); } })),
      h('div', { class: 'row' }, num('Row height', 'rowHeight', 20, 60), num('Bar height %', 'barHeight', 20, 100), num('Corner radius', 'barRadius', 0, 20)),
      h('div', { class: 'subhead' }, 'Design'),
      h('div', { class: 'color-grid' },
        dsel('Header style', 'header', [['solid', 'Solid band'], ['underline', 'Underline'], ['rounded', 'Rounded pills'], ['plain', 'Plain text']]),
        dsel('Bar style', 'bar', [['solid', 'Solid'], ['outline', 'Outline'], ['gradient', 'Gradient'], ['striped', 'Striped'], ['shadow', 'Raised (shadow)']]),
        dsel('Phase style', 'group', [['bracket', 'Bracket'], ['bar', 'Thick bar'], ['line', 'Line with ends'], ['heading', 'Text heading only']]),
        dsel('Milestone marker', 'milestone', SHAPES.map(s => [s.id, s.label] as [string, string])),
        dsel('Gate marker', 'gate', SHAPES.map(s => [s.id, s.label] as [string, string])),
        dsel('Note marker', 'note', SHAPES.map(s => [s.id, s.label] as [string, string]))),
      h('div', { class: 'subhead' }, 'Layout'),
      h('div', { class: 'color-grid' },
        dsel('Title', 'title', [['plain', 'Plain'], ['banner', 'Banner (title left, subtitle right)'], ['center', 'Centred'], ['split', 'Title + description']]),
        dsel('Page frame', 'frame', [['none', 'None'], ['footer-band', 'Footer band'], ['thin-bands', 'Thin top & bottom bands'], ['rules', 'Rules above & below'], ['rule', 'Rule under title']]),
        dsel('Rows', 'rows', [['grid', 'Ruled grid'], ['bands', 'Rounded bands (chart)'], ['bands-full', 'Rounded bands (full width)'], ['line', 'Thin guide line'], ['itemline', 'Coloured guide line'], ['pillcols', 'Rounded column pills']]),
        dsel('Progress', 'progress', [['overlay', 'Filled portion'], ['percent', 'Percent text in bar'], ['status', 'Status text in bar'], ['none', 'Not shown']]),
        dsel('Phases', 'groupLabel', [['row', 'Own row'], ['side', 'Vertical pill beside rows']]),
        dsel('Legend', 'legend', [['inline', 'Inline'], ['boxes', 'Colour boxes (full width)']])),
      h('div', { class: 'row wrap' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.design.cells, onchange: (e: Event) => { draft.design.cells = (e.target as HTMLInputElement).checked; updatePreview(); } }), 'Fill whole grid cells'),
        dopt('Highlight current period', 'highlight', '#86e3c5'),
        dopt('Colour for 100% tasks', 'doneColor', '#3f97b0'),
        dopt('Gradient end colour', 'gradientTo', '#e79bf5')),
      h('label', { class: 'field' }, 'Label column heading', h('input', { type: 'text', value: draft.design.labelHeading, placeholder: 'ACTIVITY', oninput: (e: Event) => { draft.design.labelHeading = (e.target as HTMLInputElement).value; updatePreview(); } })),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Grid', h('select', { onchange: (e: Event) => { draft.gridStyle = (e.target as HTMLSelectElement).value as any; updatePreview(); } },
          ...(['solid', 'dashed', 'none'] as const).map(g => h('option', { value: g, selected: draft.gridStyle === g }, g)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.zebra, onchange: (e: Event) => { draft.zebra = (e.target as HTMLInputElement).checked; updatePreview(); } }), 'Striped rows')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => {
          const t: Theme = { ...draft, id: 'custom-' + uid(), builtin: false, name: draft.name || 'My design' };
          store.upsertTheme(t); store.mutate(p => { p.themeId = t.id; }, true); draft = t; toast('Saved as new design'); render();
        } }, 'Save as new design'),
        isCustom && h('button', { class: 'btn', onclick: () => { store.upsertTheme({ ...draft }); toast('Design updated'); } }, 'Update this design'),
        h('button', { class: 'btn', onclick: () => { store.mutate(p => { p.themeId = BUILTIN_THEMES.some(b => b.id === draft.id) || isCustom ? draft.id : p.themeId; }, true); toast('Applied to project'); } }, 'Apply to project'),
        h('button', { class: 'btn', onclick: () => download(`${slug(draft.name)}.design.json`, JSON.stringify({ ...draft, builtin: undefined }, null, 2), 'application/json') }, 'Export design'),
        h('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('.json'); if (!f) return;
          try {
            const t = validateTheme(JSON.parse(await readFileText(f)));
            if (!t) throw new Error('Not a valid design file.');
            t.id = 'custom-' + uid(); store.upsertTheme(t); draft = JSON.parse(JSON.stringify(t)); toast(`Imported "${t.name}"`); render();
          } catch (e: any) { toast(e.message, 'error'); }
        } }, 'Import design'),
        isCustom && h('button', { class: 'btn danger', onclick: () => {
          if (confirm(`Delete design "${draft.name}"?`)) { store.removeTheme(draft.id); draft = JSON.parse(JSON.stringify(BUILTIN_THEMES[0])); render(); }
        } }, 'Delete')),
      h('p', { class: 'hint' }, 'Tip: an exported .design.json can be shared with others and loaded via “Import design”.'));
    root.append(left, h('div', { class: 'dlg-col' }, h('p', { class: 'hint' }, 'Live preview (current project)'), preview));
    updatePreview();
  };
  render();
  modal('Designs', root);
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
