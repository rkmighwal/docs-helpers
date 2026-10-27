import { describe, expect, it } from 'vitest';
import { addDays, addWorkingDays, countWorkingDays, diffDays, isoWeek, periodStart, addPeriods } from '../src/dates';
import { buildAxis } from '../src/scale';
import { newItem, newProject, normalizeProject, normalizeStyle, recalcItem, sampleProject } from '../src/model';
import { renderTimeline } from '../src/render';
import { BUILTIN_THEMES } from '../src/themes';
import { TEMPLATES, applyTemplate } from '../src/templates';
import { mergeImport, parseImport } from '../src/export';

const ctx = (holidays: string[] = []) => ({ weekend: [0, 6], holidays: new Set(holidays) });

describe('working days', () => {
  it('skips weekends (2026-03-02 is a Monday)', () => {
    expect(addWorkingDays('2026-03-02', 5, ctx())).toBe('2026-03-06');
    expect(addWorkingDays('2026-03-02', 6, ctx())).toBe('2026-03-09');
  });
  it('skips holidays', () => {
    expect(addWorkingDays('2026-03-02', 5, ctx(['2026-03-04']))).toBe('2026-03-09');
  });
  it('round-trips days <-> end date', () => {
    for (const n of [1, 2, 5, 9, 23]) {
      const end = addWorkingDays('2026-03-02', n, ctx(['2026-03-10']));
      expect(countWorkingDays('2026-03-02', end, ctx(['2026-03-10']))).toBe(n);
    }
  });
  it('does not hang when every day is a weekend', () => {
    expect(() => addWorkingDays('2026-03-02', 3, { weekend: [0, 1, 2, 3, 4, 5, 6], holidays: new Set() })).not.toThrow();
  });
});

describe('recalcItem', () => {
  it('days mode computes end; end mode computes days', () => {
    const it = newItem('task', '2026-03-02'); it.workingDays = 5;
    recalcItem(it, ctx());
    expect(it.end).toBe('2026-03-06');
    it.durationMode = 'end'; it.end = '2026-03-13';
    recalcItem(it, ctx());
    expect(it.workingDays).toBe(10);
  });
  it('milestones are single-day', () => {
    const m = newItem('milestone', '2026-03-02'); m.end = '2026-04-01';
    recalcItem(m, ctx());
    expect(m.end).toBe(m.start);
  });
});

describe('periods and axis', () => {
  it('aligns period starts', () => {
    expect(periodStart('2026-03-04', 'week')).toBe('2026-03-02');
    expect(periodStart('2026-05-17', 'quarter')).toBe('2026-04-01');
    expect(periodStart('2026-05-17', 'year')).toBe('2026-01-01');
    expect(addPeriods('2026-11-01', 'month', 3)).toBe('2027-02-01');
    expect(isoWeek('2026-01-01')).toBe(1);
  });
  for (const scale of ['week', 'month', 'quarter', 'year'] as const) {
    it(`axis ${scale}: xOf/dateAt are consistent`, () => {
      const p = newProject(); p.scale = scale; p.startDate = periodStart('2026-03-04', scale); p.periods = 6;
      const a = buildAxis(p);
      expect(a.cols).toHaveLength(6);
      expect(a.xOf(a.rangeStart)).toBe(0);
      expect(a.xOf(a.rangeEnd)).toBe(a.width);
      const d = addDays(a.rangeStart, Math.min(20, diffDays(a.rangeStart, a.rangeEnd) - 1));
      expect(a.dateAt(a.xOf(d) + 0.01)).toBe(d);
    });
  }
});

describe('render + import', () => {
  it('renders every template with its theme, at every scale, without NaN', () => {
    for (const tpl of TEMPLATES) for (const scale of ['week', 'month', 'quarter', 'year'] as const) {
      const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale);
      applyTemplate(p, tpl);
      const t = BUILTIN_THEMES.find(x => x.id === p.themeId)!;
      p.legend.custom.push({ label: 'Custom <&>', color: '#123456' });
      const r = renderTimeline(p, t, { interactive: true, holidays: [{ date: p.startDate, name: 'X' }] });
      expect(r.svg).not.toContain('NaN');
      expect(r.svg).toContain('Milestone');
      expect(r.svg).toContain('Custom &lt;&amp;&gt;');
    }
  });
  it('export omits interaction attributes', () => {
    const r = renderTimeline(sampleProject(), BUILTIN_THEMES[0], { interactive: false, holidays: [] });
    expect(r.svg).not.toContain('data-');
  });
  it('parses bundles / bare projects and rejects junk', () => {
    const p = sampleProject();
    expect(parseImport(JSON.stringify({ project: p, holidayLists: [] })).projects[0].items).toHaveLength(p.items.length);
    expect(parseImport(JSON.stringify(p)).projects).toHaveLength(1);
    expect(() => parseImport('nope')).toThrow();
    expect(() => parseImport('{"a":1}')).toThrow();
  });
  it('normalizeProject repairs missing fields', () => {
    const p = normalizeProject({ items: [{ type: 'bogus', level: 99 }] });
    expect(p.items[0].type).toBe('task');
    expect(p.items[0].level).toBe(3);
    expect(p.legend.show).toBe(true);
  });
  it('mergeImport re-ids colliding projects', () => {
    const p = sampleProject();
    const lib: any = { projects: [p], holidayLists: [], customThemes: [], activeId: p.id };
    const added = mergeImport(lib, parseImport(JSON.stringify({ project: p })));
    expect(lib.projects).toHaveLength(2);
    expect(added[0].id).not.toBe(p.id);
  });
});

import { remapDate, periodIndexOf, ANCHOR } from '../src/dates';
import { setUseDates } from '../src/model';
import { SHAPES } from '../src/shapes';
import { validateTheme } from '../src/themes';

describe('relative (no-date) timelines', () => {
  it('labels columns Week 0, Week 1…', () => {
    const p = sampleProject(); setUseDates(p, false); p.scale = 'week'; p.firstIndex = 0;
    const a = buildAxis(p);
    expect(a.cols[0].label).toBe('Week 0');
    expect(a.cols[3].label).toBe('Week 3');
    expect(a.groups).toHaveLength(0);
    p.firstIndex = 1;
    expect(buildAxis(p).cols[0].label).toBe('Week 1');
  });
  it('relative numbering also works with dates', () => {
    const p = sampleProject(); p.scale = 'week'; p.startDate = periodStart(p.startDate, 'week'); p.numbering = 'relative';
    const a = buildAxis(p);
    expect(a.cols[2].label).toBe('Week 2');
    expect(a.cols[2].sub).toBeTruthy();
  });
  it('toggling dates off and on keeps items in the same period', () => {
    const p = sampleProject(); p.scale = 'week'; p.startDate = periodStart(p.startDate, 'week');
    const before = p.items.map(i => [i.start, i.end]);
    setUseDates(p, false);
    expect(p.startDate).toBe(ANCHOR);
    expect(periodIndexOf(p.items[0].start, ANCHOR, 'week')).toBe(0);
    setUseDates(p, true);
    expect(p.items.map(i => [i.start, i.end])).toEqual(before);
  });
  it('remapDate clamps to the last day of shorter months', () => {
    expect(remapDate('2026-01-31', 'month', '2026-01-01', '2026-02-01')).toBe('2026-02-28');
  });
  it('renders relative timelines with no calendar artefacts', () => {
    const p = sampleProject(); setUseDates(p, false); p.showDates = true;
    const r = renderTimeline(p, BUILTIN_THEMES[0], { interactive: false, holidays: [{ date: '2001-01-02', name: 'x' }] });
    expect(r.svg).toContain('Month 0');
    expect(r.svg).not.toContain('Today');
    expect(r.svg).not.toContain('Public holiday');
    expect(r.svg).not.toContain('NaN');
  });
});

describe('designs and icons', () => {
  it('every shape, bar style and group style renders', () => {
    for (const bar of ['solid', 'outline', 'gradient', 'striped', 'shadow'] as const)
      for (const group of ['bracket', 'bar', 'line'] as const)
        for (const header of ['solid', 'underline', 'rounded'] as const) {
          const th = JSON.parse(JSON.stringify(BUILTIN_THEMES[0])); th.design = { ...th.design, bar, group, header };
          const p = sampleProject();
          p.items.forEach((it, i) => { it.icon = SHAPES[i % SHAPES.length].id; if (it.type === 'task') it.barStyle = bar; });
          const r = renderTimeline(p, th, { interactive: true, holidays: [] });
          expect(r.svg).not.toContain('NaN');
          expect(r.svg).not.toContain('undefined');
        }
  });
  it('legend separates items that look different and honours legend labels', () => {
    const p = sampleProject();
    const m = p.items.find(i => i.type === 'milestone')!;
    m.color = '#ff00ff'; m.legendLabel = 'Customer launch';
    const g = p.items.find(i => i.type === 'gate')!; g.icon = 'star';
    const svg = renderTimeline(p, BUILTIN_THEMES[0], { interactive: false, holidays: [] }).svg;
    expect(svg).toContain('Customer launch');
    expect(svg).toContain('Gate / check-point');
  });
  it('legacy themes without a design block still validate', () => {
    const t = validateTheme({ name: 'old', colors: BUILTIN_THEMES[0].colors });
    expect(t?.colors.task).toBe(BUILTIN_THEMES[0].colors.task);
    expect((t as any).design).toBeUndefined();
  });
});

import { effectiveGroupBy, GROUP_OPTIONS } from '../src/scale';

describe('column grouping (sub-division)', () => {
  const mk = (scale: any, groupBy: any, useDates = true) => {
    const p = newProject(); p.scale = scale; p.groupBy = groupBy; p.useDates = useDates; p.startDate = useDates ? '2026-01-01' : '2001-01-01';
    p.periods = scale === 'week' ? 26 : scale === 'month' ? 12 : 8; return p;
  };
  it('months under quarters', () => {
    const a = buildAxis(mk('month', 'quarter'));
    expect(a.groups.map(g => g.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
    expect(a.groups.every(g => g.w === a.colW * 3)).toBe(true);
  });
  it('months under years, quarters under years', () => {
    expect(buildAxis(mk('month', 'year')).groups.map(g => g.label)).toEqual(['2026']);
    expect(buildAxis(mk('quarter', 'year')).groups.map(g => g.label)).toEqual(['2026', '2027']);
  });
  it('weeks under months and quarters', () => {
    const m = buildAxis(mk('week', 'month')), q = buildAxis(mk('week', 'quarter'));
    expect(m.groups[0].label).toBe('Jan 2026');
    expect(q.groups.map(g => g.label)).toEqual(['Q1 2026', 'Q2 2026']);
    expect(q.groups.reduce((s, g) => s + g.w, 0)).toBe(q.width);
  });
  it('none / invalid combinations produce no group row', () => {
    expect(buildAxis(mk('month', 'none')).groups).toHaveLength(0);
    expect(buildAxis(mk('quarter', 'month')).groups).toHaveLength(0);
    expect(buildAxis(mk('year', 'year')).groups).toHaveLength(0);
    expect(effectiveGroupBy(mk('week', 'auto'))).toBe('month');
    expect(effectiveGroupBy(mk('month', 'auto', false))).toBe('none');
    expect(GROUP_OPTIONS.year).toEqual(['none']);
  });
  it('relative timelines can group too', () => {
    const a = buildAxis(mk('month', 'quarter', false));
    expect(a.groups.map(g => g.label)).toEqual(['Quarter 0', 'Quarter 1', 'Quarter 2', 'Quarter 3']);
    const r = renderTimeline(mk('month', 'quarter', false), BUILTIN_THEMES[0], { interactive: false, holidays: [] });
    expect(r.svg).toContain('Quarter 1');
  });
  it('normalizeProject repairs a bad groupBy', () => {
    expect(normalizeProject({ groupBy: 'decade' }).groupBy).toBe('auto');
  });
});

describe('themes and templates are separate', () => {
  it('every template names an existing theme, and ids are unique', () => {
    const ids = new Set(TEMPLATES.map(x => x.id));
    expect(ids.size).toBe(TEMPLATES.length);
    expect(new Set(BUILTIN_THEMES.map(x => x.id)).size).toBe(BUILTIN_THEMES.length);
    for (const tpl of TEMPLATES) expect(BUILTIN_THEMES.some(th => th.id === tpl.themeId)).toBe(true);
  });
  it('a theme holds only colours and a font', () => {
    for (const th of BUILTIN_THEMES) expect(Object.keys(th).sort()).toEqual(['builtin', 'colors', 'fontFamily', 'id', 'name']);
  });
  it('applying a template sets the layout and the theme, and leaves the items alone', () => {
    const p = sampleProject(); const items = JSON.stringify(p.items);
    const tpl = TEMPLATES.find(x => x.id === 'tpl-blue-modern')!;
    applyTemplate(p, tpl);
    expect(p.themeId).toBe('tpl-blue-modern');
    expect(p.templateId).toBe('tpl-blue-modern');
    expect(p.style.design.title).toBe('banner');
    expect(p.style.rowHeight).toBe(40);
    expect(JSON.stringify(p.items)).toBe(items);
    p.style.design.title = 'plain'; // editing the project's layout does not touch the template
    expect(tpl.style.design.title).toBe('banner');
  });
  it('changing the theme keeps the layout; the same layout renders with different colours', () => {
    const p = sampleProject(); applyTemplate(p, TEMPLATES.find(x => x.id === 'modern')!);
    const a = renderTimeline(p, BUILTIN_THEMES.find(x => x.id === 'modern')!, { interactive: false, holidays: [] }).svg;
    const b = renderTimeline(p, BUILTIN_THEMES.find(x => x.id === 'sunrise')!, { interactive: false, holidays: [] }).svg;
    expect(a).not.toBe(b);
    expect(a.replace(/#[0-9a-f]{6}/gi, '#').replace(/font-family="[^"]*"/, '')).toBe(b.replace(/#[0-9a-f]{6}/gi, '#').replace(/font-family="[^"]*"/, ''));
  });
  it('normalizeStyle repairs junk', () => {
    const s = normalizeStyle({ rowHeight: 9999, barHeight: 'x', gridStyle: 'wavy', zebra: false, design: { header: 'neon', milestone: 'nope', statusColors: ['#fff'], title: 'banner' } });
    expect(s.rowHeight).toBe(60);
    expect(s.barHeight).toBe(60);
    expect(s.gridStyle).toBe('solid');
    expect(s.zebra).toBe(false);
    expect(s.design.header).toBe('solid');
    expect(s.design.milestone).toBe('diamond');
    expect(s.design.statusColors).toEqual([]);
    expect(s.design.title).toBe('banner');
    expect(normalizeStyle(null).design.bar).toBe('solid');
  });
});

describe('files saved before the split', () => {
  const sample = () => { const p: any = JSON.parse(JSON.stringify(sampleProject())); delete p.style; delete p.templateId; return p; };
  it('a project on a built-in design gets that design’s layout as its template', () => {
    const raw = sample(); raw.themeId = 'tpl-orange-purple';
    const lib = parseImport(JSON.stringify({ project: raw, holidayLists: [] }));
    const p = lib.projects[0];
    expect(p.themeId).toBe('tpl-orange-purple');
    expect(p.templateId).toBe('tpl-orange-purple');
    expect(p.style).toEqual(TEMPLATES.find(x => x.id === 'tpl-orange-purple')!.style);
  });
  it('a project on a custom design keeps that design’s layout; the theme keeps only its colours', () => {
    const raw = sample(); raw.themeId = 'custom-1';
    const oldTheme = { id: 'custom-1', name: 'Mine', colors: BUILTIN_THEMES[0].colors, fontFamily: 'Georgia', rowHeight: 44, barHeight: 80, barRadius: 9, gridStyle: 'none', zebra: false, design: { bar: 'gradient', title: 'center' } };
    const r = parseImport(JSON.stringify({ project: raw, holidayLists: [], customThemes: [oldTheme] }));
    expect(r.projects[0].style.rowHeight).toBe(44);
    expect(r.projects[0].style.design.bar).toBe('gradient');
    expect(r.projects[0].templateId).toBe('');
    expect(r.themes[0].name).toBe('Mine');
    expect(r.themes[0].fontFamily).toBe('Georgia');
    expect((r.themes[0] as any).rowHeight).toBeUndefined();
  });
  it('an unknown design falls back to the default layout', () => {
    const raw = sample(); raw.themeId = 'gone';
    expect(parseImport(JSON.stringify({ project: raw })).projects[0].style.rowHeight).toBe(30);
  });
  it('new files carry their own layout and round-trip', () => {
    const p = sampleProject(); applyTemplate(p, TEMPLATES.find(x => x.id === 'tpl-yellow-purple')!);
    const q = parseImport(JSON.stringify({ project: p })).projects[0];
    expect(q.style).toEqual(p.style);
    expect(q.templateId).toBe('tpl-yellow-purple');
  });
});

import { workDaysLabel, workDaysOf } from '../src/dates';
describe('working days (the inverse of the weekend)', () => {
  it('derives working days from weekend days', () => {
    expect(workDaysOf([0, 6])).toEqual([1, 2, 3, 4, 5]);
    expect(workDaysOf([5, 6])).toEqual([0, 1, 2, 3, 4]);
    expect(workDaysOf([])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(workDaysOf([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6]); // all "weekend" = every day counts, as in the maths
  });
  it('summarises them', () => {
    expect(workDaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(workDaysLabel([0, 1, 2, 3, 4])).toBe('Mon–Thu, Sun');
    expect(workDaysLabel([1, 2, 4])).toBe('Mon, Tue, Thu');
    expect(workDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
  });
  it('a Sun–Thu week gives different working-day results', () => {
    const ctx = { weekend: [5, 6], holidays: new Set<string>() };
    expect(addWorkingDays('2026-03-01', 5, ctx)).toBe('2026-03-05'); // Sun..Thu
  });
});
