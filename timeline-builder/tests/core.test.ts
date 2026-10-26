import { describe, expect, it } from 'vitest';
import { addDays, addWorkingDays, countWorkingDays, diffDays, isoWeek, periodStart, addPeriods } from '../src/dates';
import { buildAxis } from '../src/scale';
import { newItem, newProject, normalizeProject, recalcItem, sampleProject } from '../src/model';
import { renderTimeline } from '../src/render';
import { BUILTIN_THEMES } from '../src/themes';
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
  it('renders every theme and scale without NaN', () => {
    for (const t of BUILTIN_THEMES) for (const scale of ['week', 'month', 'quarter', 'year'] as const) {
      const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale);
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
    expect(t?.design.bar).toBe('solid');
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
