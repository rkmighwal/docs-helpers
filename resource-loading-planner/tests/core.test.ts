import { describe, expect, it } from 'vitest';
import { addDays, dayNum, periodStart, weekdayOf } from '../src/dates';
import { buildAxis } from '../src/scale';
import { Allocation, Project, newProject, normalizeProject, sampleProject, setUseDates, uid } from '../src/model';
import { aggregate, buildCalendar, capacityOf, dailyLoad, overall } from '../src/calc';
import { buildTable } from '../src/table';
import { renderPlan, workDaysLabel } from '../src/render';
import { BUILTIN_THEMES, validateTheme } from '../src/themes';
import { TEMPLATES, applyTemplate } from '../src/templates';
import { crc32, buildXlsx, colName } from '../src/xlsx';
import { exportXlsx } from '../src/excel';
import { mergeImport, parseImport } from '../src/export';
import { DEFAULT_IMPORT, applyTimelineImport, parseTimelineFile } from '../src/tbimport';

/** A weekly project starting Monday 2026-03-02 with one work stream and one skill. */
function weekly(periods = 4): Project {
  const p = newProject('T');
  p.scale = 'week'; p.startDate = '2026-03-02'; p.periods = periods; p.groupBy = 'none';
  p.workstreams = [{ id: 'w1', name: 'Alpha', color: '#2563eb' }, { id: 'w2', name: 'Beta', color: '#16a34a' }];
  p.skills = [{ id: 's1', name: 'Dev', color: '#111111' }, { id: 's2', name: 'QA', color: '#222222' }];
  return p;
}
const alloc = (o: Partial<Allocation>): Allocation => ({ id: uid(), workstreamId: 'w1', skillId: 's1', label: '', start: '2026-03-02', end: '2026-03-06', count: 1, ...o });
const calFor = (p: Project, holidays: string[] = []) => buildCalendar(buildAxis(p), p.workDays, holidays);

describe('dates', () => {
  it('day numbers and weekdays', () => {
    expect(weekdayOf(dayNum('2026-03-02'))).toBe(1); // Monday
    expect(weekdayOf(dayNum('1970-01-01'))).toBe(4); // Thursday
    expect(weekdayOf(dayNum('1969-12-31'))).toBe(3);
  });
});

describe('working calendar', () => {
  it('counts Mon-Fri by default', () => {
    const c = calFor(weekly());
    expect(c.colDays).toEqual([5, 5, 5, 5]);
  });
  it('honours the chosen days of the week', () => {
    const p = weekly(); p.workDays = [1, 2, 3];
    expect(calFor(p).colDays).toEqual([3, 3, 3, 3]);
    p.workDays = [0, 1, 2, 3, 4, 5, 6];
    expect(calFor(p).colDays[0]).toBe(7);
  });
  it('skips holidays', () => {
    expect(calFor(weekly(), ['2026-03-04']).colDays).toEqual([4, 5, 5, 5]);
  });
  it('months have the right number of working days', () => {
    const p = newProject(); p.scale = 'month'; p.startDate = '2026-03-01'; p.periods = 2;
    expect(calFor(p).colDays).toEqual([22, 22]); // March 2026, April 2026
  });
});

describe('loading measures', () => {
  it('headcount is the concurrent peak, not the sum of peaks', () => {
    const p = weekly();
    p.allocations = [alloc({ start: '2026-03-02', end: '2026-03-06' }), alloc({ start: '2026-03-04', end: '2026-03-10' })];
    const cal = calFor(p), d = dailyLoad(p.allocations, p, cal);
    expect(aggregate(d, cal, 'headcount')).toEqual([2, 1, 0, 0]);
    expect(overall(d, cal, 'headcount')).toBe(2);
  });
  it('FTE averages over working days, person-days sums', () => {
    const p = weekly();
    p.allocations = [alloc({ start: '2026-03-02', end: '2026-03-04', count: 2 })]; // 2 people x 3 days
    const cal = calFor(p), d = dailyLoad(p.allocations, p, cal);
    expect(aggregate(d, cal, 'days')[0]).toBe(6);
    expect(aggregate(d, cal, 'fte')[0]).toBe(1.2);
    expect(overall(d, cal, 'days')).toBe(6);
  });
  it('weekends and non-working days carry no load', () => {
    const p = weekly(); p.workDays = [1, 2, 3, 4, 5];
    p.allocations = [alloc({ start: '2026-03-07', end: '2026-03-08' })]; // Sat-Sun only
    const cal = calFor(p);
    expect(aggregate(dailyLoad(p.allocations, p, cal), cal, 'headcount')).toEqual([0, 0, 0, 0]);
    p.workDays = [0, 1, 2, 3, 4, 5, 6];
    const cal2 = calFor(p);
    expect(aggregate(dailyLoad(p.allocations, p, cal2), cal2, 'headcount')[0]).toBe(1);
  });
  it('allocations outside the timeline are ignored safely', () => {
    const p = weekly();
    p.allocations = [alloc({ start: '2020-01-01', end: '2020-02-01' }), alloc({ start: '2026-02-20', end: '2026-03-03' }), alloc({ start: '2026-03-20', end: '2030-01-01' })];
    const cal = calFor(p);
    expect(aggregate(dailyLoad(p.allocations, p, cal), cal, 'headcount')).toEqual([1, 0, 1, 1]);
  });
  it('linked allocations follow their task', () => {
    const p = weekly();
    p.tasks = [{ id: 't1', name: 'Build', start: '2026-03-09', end: '2026-03-13', level: 0, kind: 'task' }];
    p.allocations = [alloc({ taskId: 't1', start: '2026-03-02', end: '2026-03-02' })];
    const cal = calFor(p);
    expect(aggregate(dailyLoad(p.allocations, p, cal), cal, 'headcount')).toEqual([0, 1, 0, 0]);
  });
  it('capacity comes from resources, under their primary skill', () => {
    const p = weekly();
    p.resources = [{ id: 'r1', name: 'A', skillIds: ['s1', 's2'], fte: 1 }, { id: 'r2', name: 'B', skillIds: ['s2'], fte: 0.5, from: '2026-03-09' }];
    const cal = calFor(p), cap = capacityOf(p, cal);
    expect(aggregate(cap.total, cal, 'headcount')).toEqual([1, 1.5, 1.5, 1.5]);
    expect(aggregate(cap.bySkill.get('s1')!, cal, 'headcount')).toEqual([1, 1, 1, 1]);
    expect(aggregate(cap.bySkill.get('s2')!, cal, 'headcount')).toEqual([0, 0.5, 0.5, 0.5]);
  });
});

describe('table model', () => {
  it('groups by work stream with subtotals and a total', () => {
    const p = weekly();
    p.allocations = [alloc({ workstreamId: 'w1', skillId: 's1', count: 2 }), alloc({ workstreamId: 'w1', skillId: 's2', count: 1 }), alloc({ workstreamId: 'w2', skillId: 's1', count: 3 })];
    const t = buildTable(p);
    expect(t.rows.map(r => `${r.kind}:${r.label}`)).toEqual(['group:Alpha', 'row:Dev', 'row:QA', 'group:Beta', 'row:Dev', 'total:Total resources loaded']);
    expect(t.rows[0].values).toEqual([3, 0, 0, 0]);
    expect(t.rows[5].values).toEqual([6, 0, 0, 0]);
  });
  it('merges allocations that share a work stream and skill', () => {
    const p = weekly();
    p.allocations = [alloc({ start: '2026-03-02', end: '2026-03-06', count: 2 }), alloc({ start: '2026-03-09', end: '2026-03-13', count: 4 })];
    const t = buildTable(p);
    const dev = t.rows.filter(r => r.kind === 'row');
    expect(dev).toHaveLength(1);
    expect(dev[0].values).toEqual([2, 4, 0, 0]);
    p.view.detail = 'lines';
    expect(buildTable(p).rows.filter(r => r.kind === 'row')).toHaveLength(2);
  });
  it('can group by skill, by resource, or not at all', () => {
    const p = weekly();
    p.resources = [{ id: 'r1', name: 'Rita', skillIds: ['s1'], fte: 1 }];
    p.allocations = [alloc({ resourceId: 'r1' }), alloc({ workstreamId: 'w2', skillId: 's2' })];
    p.view.groupBy = 'skill';
    expect(buildTable(p).rows.filter(r => r.kind === 'group').map(r => r.label)).toEqual(['Dev', 'QA']);
    p.view.groupBy = 'resource';
    expect(buildTable(p).rows.filter(r => r.kind === 'group').map(r => r.label)).toEqual(['Rita (Dev)', 'Unassigned (by skill)']);
    p.view.groupBy = 'none';
    expect(buildTable(p).rows.some(r => r.kind === 'group')).toBe(false);
  });
  it('flags over-allocation against capacity and adds spare/shortfall', () => {
    const p = weekly();
    p.resources = [{ id: 'r1', name: 'A', skillIds: ['s1'], fte: 1 }];
    p.allocations = [alloc({ count: 3 })];
    p.view.showCapacity = true; p.view.showGap = true; p.view.showSkillSummary = true;
    const t = buildTable(p);
    const total = t.rows.find(r => r.kind === 'total')!;
    expect(total.limit).toEqual([1, 1, 1, 1]);
    expect(t.rows.find(r => r.kind === 'gap')!.values).toEqual([-2, 1, 1, 1]);
    expect(t.rows.find(r => r.kind === 'skill')!.limit).toBeTruthy();
    const svg = renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg;
    expect(svg).toContain('Over available capacity');
  });
  it('is empty-safe', () => {
    const t = buildTable(weekly());
    expect(t.empty).toBe(true);
    expect(renderPlan(weekly(), BUILTIN_THEMES[0], [], { interactive: true }).svg).toContain('Nothing is loaded yet');
  });
  it('relative timelines work without dates', () => {
    const p = sampleProject(); setUseDates(p, false);
    const t = buildTable(p, ['2001-01-02']);
    expect(t.axis.cols[0].label).toBe('M1');
    expect(t.rows.find(r => r.kind === 'total')!.values.some(v => v > 0)).toBe(true);
    setUseDates(p, true);
    expect(p.useDates).toBe(true);
  });
  it('toggling dates off and on keeps allocations in the same period', () => {
    const p = sampleProject();
    const before = p.allocations.map(a => [a.start, a.end]);
    setUseDates(p, false);
    setUseDates(p, true);
    expect(p.allocations.map(a => [a.start, a.end])).toEqual(before);
  });
  it('groups week columns under months', () => {
    const p = weekly(8); p.groupBy = 'month';
    expect(buildAxis(p).groups.map(g => g.label)).toEqual(['Mar 2026', 'Apr 2026']);
  });
});

describe('rendering', () => {
  it('renders every theme, template and scale without NaN and escapes text', () => {
    for (const tpl of TEMPLATES) for (const scale of ['week', 'month', 'quarter', 'year'] as const) {
      const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale);
      p.title = 'A <&> "B"'; p.footerText = 'foot <x>';
      applyTemplate(p, tpl);
      p.view.showWorkingDays = true; p.view.colStart = p.view.colEnd = p.view.colQty = p.view.colSkill = p.view.colResource = true;
      const theme = BUILTIN_THEMES.find(t => t.id === p.themeId)!;
      const r = renderPlan(p, theme, [p.startDate], { interactive: true });
      expect(r.svg).not.toContain('NaN');
      expect(r.svg).not.toContain('undefined');
      expect(r.svg).toContain('A &lt;&amp;&gt; &quot;B&quot;');
      expect(r.width).toBeGreaterThan(100);
    }
  });
  it('every built-in theme renders every cell mode', () => {
    for (const theme of BUILTIN_THEMES) for (const cell of ['number', 'heat', 'bar', 'chip', 'fill'] as const) {
      const p = sampleProject(); p.style.cell = cell;
      expect(renderPlan(p, theme, [], { interactive: false }).svg).not.toContain('NaN');
    }
  });
  it('exports omit interaction attributes; the preview has them', () => {
    const p = sampleProject();
    expect(renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg).not.toContain('data-alloc');
    expect(renderPlan(p, BUILTIN_THEMES[0], [], { interactive: true }).svg).toContain('data-alloc');
  });
  it('border switches change the drawing', () => {
    const p = sampleProject();
    const all = renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg;
    p.style.borders = { outer: false, header: false, rows: false, cols: false, labels: false, groups: false, total: false };
    const none = renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg;
    expect(none.length).toBeLessThan(all.length);
    expect(none).toContain('<g stroke=');
    expect(none).not.toContain('<path d=');
  });
  it('summarises working days', () => {
    expect(workDaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(workDaysLabel([1, 2, 4])).toBe('Mon, Tue, Thu');
    expect(workDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('every day');
    expect(workDaysLabel([0, 1, 2, 3, 4])).toBe('Mon–Thu, Sun');
    expect(workDaysLabel([5, 6, 0])).toBe('Fri–Sun');
  });
});

describe('Excel export', () => {
  /** Minimal reader for the central directory, enough to prove the archive is well formed. */
  function readZip(buf: Uint8Array) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = buf.length - 22;
    while (dv.getUint32(e, true) !== 0x06054b50) e--;
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      expect(dv.getUint32(p, true)).toBe(0x02014b50);
      const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
      const lnl = dv.getUint16(off + 26, true);
      const data = buf.subarray(off + 30 + lnl, off + 30 + lnl + size);
      expect(dv.getUint32(off, true)).toBe(0x04034b50);
      expect(crc32(data)).toBe(crc);
      out[name] = new TextDecoder().decode(data);
      p += 46 + nl;
    }
    return out;
  }
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('names columns', () => {
    expect([colName(0), colName(25), colName(26), colName(701), colName(702)]).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });
  it('writes a well-formed workbook with the plan and the data sheets', () => {
    const p = sampleProject(); p.title = 'Plan & <Co>';
    const files = readZip(exportXlsx(p, BUILTIN_THEMES[0], []));
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml']);
    expect(files['xl/worksheets/sheet1.xml']).toContain('Plan &amp; &lt;Co&gt;');
    expect(files['xl/worksheets/sheet1.xml']).toContain('Total resources loaded');
    expect(files['xl/worksheets/sheet1.xml']).toContain('<pane');
    expect(files['xl/worksheets/sheet2.xml']).toContain('Developer');
    expect(files['xl/workbook.xml']).toContain('Loading plan');
    for (const [k, v] of Object.entries(files)) if (k.endsWith('.xml') || k.endsWith('.rels')) expect(v.startsWith('<?xml')).toBe(true);
  });
  it('de-duplicates sheet names', () => {
    const files = readZip(buildXlsx([{ name: 'A', rows: [[{ v: 1 }]] }, { name: 'a', rows: [[{ v: 'x' }]] }]));
    expect(files['xl/workbook.xml']).toContain('name="A"');
    expect(files['xl/workbook.xml']).toContain('name="a 2"');
  });
  it('exports every template and scale', () => {
    for (const tpl of TEMPLATES) for (const scale of ['week', 'quarter', 'year'] as const) {
      const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale); p.periods = 6; applyTemplate(p, tpl);
      p.view.showWorkingDays = true; p.view.colStart = true; p.view.colQty = true;
      expect(() => exportXlsx(p, BUILTIN_THEMES.find(t => t.id === p.themeId)!, [])).not.toThrow();
    }
  });
});

describe('project files', () => {
  it('normalizeProject repairs junk and keeps references valid', () => {
    const p = normalizeProject({ scale: 'bogus', periods: 9999, workDays: [], workstreams: [{ id: 'a', name: 'X', color: 'red' }], allocations: [{ workstreamId: 'zzz', skillId: 'nope', count: -5, start: 'x' }] });
    expect(p.scale).toBe('month');
    expect(p.periods).toBe(120);
    expect(p.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(p.workstreams[0].color).toMatch(/^#/);
    expect(p.allocations[0].workstreamId).toBe('');
    expect(p.allocations[0].count).toBe(0);
    expect(normalizeProject(null).allocations).toEqual([]);
  });
  it('round-trips through JSON and imports as a new project when ids collide', () => {
    const p = sampleProject();
    const text = JSON.stringify({ app: 'resource-loading-planner', version: 1, project: p, holidayLists: [] });
    const lib: any = { projects: [p], holidayLists: [], customThemes: [], activeId: p.id };
    const added = mergeImport(lib, parseImport(text));
    expect(lib.projects).toHaveLength(2);
    expect(added[0].id).not.toBe(p.id);
    expect(added[0].allocations).toHaveLength(p.allocations.length);
  });
  it('rejects junk and points timeline files at the right importer', () => {
    expect(() => parseImport('nope')).toThrow();
    expect(() => parseImport('{"a":1}')).toThrow();
    expect(() => parseImport('{"app":"timeline-builder","project":{"items":[]}}')).toThrow(/Timeline Builder|Import tasks/);
  });
  it('validates themes', () => {
    expect(validateTheme({ colors: { bg: '#000000', text: 'nope' }, fontSize: 99 })!.fontSize).toBe(20);
    expect(validateTheme(null)).toBeNull();
  });
});

describe('Timeline Builder import', () => {
  const file = JSON.stringify({
    app: 'timeline-builder', version: 1,
    project: {
      title: 'Web relaunch', scale: 'week', startDate: '2026-03-04', periods: 10, useDates: true, weekendDays: [5, 6], holidayListIds: ['h1'],
      items: [
        { type: 'group', name: 'Discovery', start: '2026-03-02', end: '2026-03-13', level: 0 },
        { type: 'task', name: 'Interviews', start: '2026-03-02', end: '2026-03-06', level: 1 },
        { type: 'milestone', name: 'Sign-off', start: '2026-03-13', end: '2026-03-13', level: 1 },
        { type: 'group', name: 'Build', start: '2026-03-16', end: '2026-04-10', level: 0 },
        { type: 'task', name: 'Front-end', start: '2026-03-16', end: '2026-04-03', level: 1 },
        { type: 'holiday', name: 'Freeze', start: '2026-04-06', end: '2026-04-10', level: 0 },
      ],
    },
    holidayLists: [{ id: 'h1', name: 'UK', holidays: [{ date: '2026-04-03', name: 'Good Friday' }] }, { id: 'h2', name: 'Other', holidays: [] }],
  });
  it('reads bundles, backups and bare projects', () => {
    const f = parseTimelineFile(file);
    expect(f.projects).toHaveLength(1);
    expect(f.projects[0].holidayLists.map(l => l.name)).toEqual(['UK']);
    expect(parseTimelineFile(JSON.stringify({ projects: [JSON.parse(file).project, JSON.parse(file).project] })).projects).toHaveLength(2);
    expect(parseTimelineFile(JSON.stringify({ items: [] })).projects).toHaveLength(1);
    expect(() => parseTimelineFile('{}')).toThrow();
    expect(() => parseTimelineFile('x')).toThrow();
    expect(() => parseTimelineFile('{"app":"resource-loading-planner","projects":[]}')).toThrow(/Resource Loading Planner/);
  });
  it('imports the timeline, phases as work streams, tasks and loads', () => {
    const src = parseTimelineFile(file).projects[0];
    const p = newProject('X');
    const s = applyTimelineImport(p, src, DEFAULT_IMPORT, ['L1']);
    expect(p.scale).toBe('week');
    expect(p.startDate).toBe('2026-03-02');
    expect(p.periods).toBe(10);
    expect(p.workDays).toEqual([0, 1, 2, 3, 4]); // weekend was Fri+Sat
    expect(p.holidayListIds).toEqual(['L1']);
    expect(p.workstreams.map(w => w.name)).toEqual(['Discovery', 'Build']);
    expect(p.tasks.map(t => t.name)).toEqual(['Discovery', 'Interviews', 'Build', 'Front-end']); // milestone off by default, holiday band never
    expect(p.tasks.find(t => t.name === 'Front-end')!.workstreamId).toBe(p.workstreams[1].id);
    expect(p.allocations).toHaveLength(2);
    expect(p.allocations.every(a => a.taskId && a.count === 1)).toBe(true);
    expect(s).toMatchObject({ tasks: 4, workstreams: 2, loads: 2, timeline: true });
  });
  it('can add instead of replace, reuse work streams by name, and include milestones', () => {
    const src = parseTimelineFile(file).projects[0];
    const p = newProject('X');
    applyTimelineImport(p, src, DEFAULT_IMPORT);
    applyTimelineImport(p, src, { ...DEFAULT_IMPORT, replace: false, milestones: true, createLoads: false, applyTimeline: false });
    expect(p.workstreams).toHaveLength(2);
    expect(p.tasks).toHaveLength(9);
    expect(p.tasks.filter(t => t.kind === 'milestone')).toHaveLength(1);
    expect(p.allocations).toHaveLength(2);
  });
  it('replacing tasks unlinks loads but keeps their dates', () => {
    const src = parseTimelineFile(file).projects[0];
    const p = newProject('X');
    applyTimelineImport(p, src, DEFAULT_IMPORT);
    applyTimelineImport(p, src, { ...DEFAULT_IMPORT, createLoads: false });
    expect(p.allocations.every(a => a.taskId === undefined)).toBe(true);
    expect(p.allocations[0].start).toBe('2026-03-02');
  });
  it('relative timelines import as relative, and a mode mismatch always applies the timeline', () => {
    const rel = JSON.stringify({ project: { scale: 'month', useDates: false, numbering: 'relative', periods: 6, items: [{ type: 'task', name: 'A', start: '2001-01-01', end: '2001-02-28', level: 0 }] } });
    const src = parseTimelineFile(rel).projects[0];
    const p = newProject('X');
    applyTimelineImport(p, src, { ...DEFAULT_IMPORT, applyTimeline: false });
    expect(p.useDates).toBe(false);
    expect(p.startDate).toBe('2001-01-01');
    expect(buildAxis(p).cols[0].label).toBe('M0'); // numbering follows the source file
  });
});

describe('misc', () => {
  it('addDays sanity', () => { expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); });
});

describe('details', () => {
  it('Qty is the line’s own peak, even when it lies outside the visible timeline', () => {
    const p = weekly(2); p.view.detail = 'lines';
    p.allocations = [alloc({ start: '2030-01-01', end: '2030-02-01', count: 3 })];
    expect(buildTable(p).rows.find(r => r.kind === 'row')!.qty).toBe('3');
  });
  it('Qty of merged lines is the concurrent peak, not the sum', async () => {
    const { peakConcurrent } = await import('../src/table');
    const p = weekly();
    expect(peakConcurrent([alloc({ start: '2026-03-02', end: '2026-03-06', count: 2 }), alloc({ start: '2026-03-07', end: '2026-03-13', count: 4 })], p)).toBe(4);
    expect(peakConcurrent([alloc({ start: '2026-03-02', end: '2026-03-06', count: 2 }), alloc({ start: '2026-03-06', end: '2026-03-13', count: 4 })], p)).toBe(6);
  });
  it('new colours avoid the ones in use', async () => {
    const { nextColor, PALETTE } = await import('../src/model');
    expect(nextColor([PALETTE[0]])).toBe(PALETTE[1]);
    expect(nextColor(PALETTE)).toBeTruthy();
  });
});

describe('tasks and named resources show up in the outcome', () => {
  const withTasks = (): Project => {
    const p = weekly(6);
    p.tasks = [
      { id: 't1', name: 'Interviews', start: '2026-03-02', end: '2026-03-06', level: 1, kind: 'task', workstreamId: 'w1' },
      { id: 't2', name: 'Wireframes', start: '2026-03-09', end: '2026-03-20', level: 1, kind: 'task', workstreamId: 'w1' },
      { id: 't3', name: 'Build', start: '2026-03-16', end: '2026-04-10', level: 1, kind: 'task', workstreamId: 'w2' },
      { id: 'm1', name: 'Sign-off', start: '2026-03-20', end: '2026-03-20', level: 1, kind: 'milestone', workstreamId: 'w1' },
    ];
    return p;
  };
  it('linked tasks become rows (they no longer collapse into one “No skill” row)', () => {
    const p = withTasks();
    p.allocations = [alloc({ workstreamId: 'w1', skillId: '', taskId: 't1' }), alloc({ workstreamId: 'w1', skillId: '', taskId: 't2' }), alloc({ workstreamId: 'w2', skillId: '', taskId: 't3' })];
    const t = buildTable(p);
    expect(t.rows.filter(r => r.kind === 'row').map(r => r.label)).toEqual(['Interviews', 'Wireframes', 'Build']);
    expect(t.labelCols[0].title).toBe('Work stream / task');
    expect(t.rows.find(r => r.label === 'Interviews')!.values.slice(0, 2)).toEqual([1, 0]);
  });
  it('lines on the same task are added together; one row per skill with the task’s name', () => {
    const p = withTasks();
    p.allocations = [alloc({ taskId: 't1', count: 2 }), alloc({ taskId: 't1', skillId: 's2', count: 1 })];
    const rows = buildTable(p).rows.filter(r => r.kind === 'row' && r.label === 'Interviews');
    expect(rows).toHaveLength(1);
    expect(rows[0].values[0]).toBe(3);
    expect(rows[0].skill).toBe('Dev, QA');
    p.view.detail = 'lines';
    expect(buildTable(p).rows.filter(r => r.kind === 'row' && r.label.startsWith('Interviews')).map(r => r.label)).toEqual(['Interviews · Dev', 'Interviews · QA']);
  });
  it('tasks nobody is loaded onto yet are still listed, without changing any total', () => {
    const p = withTasks();
    p.allocations = [alloc({ taskId: 't1' })];
    const t = buildTable(p);
    expect(t.rows.filter(r => r.kind === 'row').map(r => r.label)).toEqual(['Interviews', 'Wireframes', 'Build']); // milestone is not a task row
    expect(t.rows.find(r => r.label === 'Build')!.values.every(x => x === 0)).toBe(true);
    expect(t.rows.find(r => r.label === 'Build')!.qty).toBe('');
    expect(t.rows.find(r => r.kind === 'total')!.values).toEqual([1, 0, 0, 0, 0, 0]);
    expect(t.rows.find(r => r.kind === 'row' && r.label === 'Build')!.allocIds[0]).toBe('task:t3');
    p.view.showEmptyTasks = false;
    expect(buildTable(p).rows.filter(r => r.kind === 'row').map(r => r.label)).toEqual(['Interviews']);
  });
  it('right after an import every imported task is a row', () => {
    const src = parseTimelineFile(JSON.stringify({ project: { scale: 'week', startDate: '2026-03-02', items: [
      { type: 'group', name: 'Phase A', start: '2026-03-02', end: '2026-03-13', level: 0 },
      { type: 'task', name: 'Task one', start: '2026-03-02', end: '2026-03-06', level: 1 },
      { type: 'task', name: 'Task two', start: '2026-03-09', end: '2026-03-13', level: 1 }] } })).projects[0];
    for (const createLoads of [true, false]) {
      const p = newProject('X'); applyTimelineImport(p, src, { ...DEFAULT_IMPORT, createLoads });
      expect(buildTable(p).rows.filter(r => r.kind === 'row').map(r => r.label)).toEqual(['Task one', 'Task two']);
    }
  });
  it('a project saved with the old default row setting shows tasks too', () => {
    const p = normalizeProject({ view: { detail: 'merged', nameHeading: 'Work stream / skill' } });
    expect(p.view.detail).toBe('auto');
    expect(p.view.nameHeading).toBe('');
    expect(normalizeProject({ view: { detail: 'skills' } }).view.detail).toBe('skills'); // an explicit choice survives
  });

  const staffed = (): Project => {
    const p = weekly();
    p.resources = [{ id: 'r1', name: 'Alice', skillIds: ['s1', 's2'], fte: 1, workstreamId: 'w1' }, { id: 'r2', name: 'Bo', skillIds: ['s2'], fte: 0.5 }, { id: 'r3', name: 'Cy', skillIds: ['s1'], fte: 1 }];
    p.allocations = [alloc({ resourceId: 'r1', count: 1 }), alloc({ resourceId: 'r1', skillId: 's2', start: '2026-03-04', end: '2026-03-10', count: 1 }), alloc({ resourceId: 'r2', skillId: 's2', count: 0.5 })];
    p.view.showSkillSummary = true; // the section the people are listed in
    return p;
  };
  it('every named resource is listed under their skill, with their own load, flagged when over their availability', () => {
    const t = buildTable(staffed());
    expect(t.rows.some(r => r.id === 'sec:people')).toBe(false); // no separate section any more
    const i = t.rows.findIndex(r => r.id === 'sec:skills');
    expect(t.rows[i].label).toBe('Loading by skill');
    const shape = t.rows.slice(i + 1).map(r => `${r.kind}:${r.level}:${r.label}`);
    // Dev (s1): Alice and Cy have it as their primary skill; QA (s2): Bo. Alice is Dev + QA but counts under Dev.
    expect(shape).toEqual(['skill:0:Dev', 'person:1:Alice (Dev, QA)', 'person:1:Cy (Dev)', 'skill:0:QA', 'person:1:Bo (QA · 0.5 FTE)']);
    const people = t.rows.filter(r => r.kind === 'person');
    expect(people[0].values).toEqual([2, 1, 0, 0]); // Alice is double-booked Wed-Fri, then on Mon-Tue
    expect(people[0].limit).toEqual([1, 1, 1, 1]);
    expect(people[0].skill).toBe('Dev, QA');
    expect(people[1].values).toEqual([0, 0, 0, 0]); // Cy has no work: still listed so spare people are visible
    const svg = renderPlan(staffed(), BUILTIN_THEMES[0], [], { interactive: false }).svg;
    expect(svg).toContain('LOADING BY SKILL');
    expect(svg).not.toContain('LOADING BY RESOURCE');
    expect(svg).toContain('Alice (Dev, QA)');
    expect(svg).toContain('Bo (QA · 0.5 FTE)');
    expect(svg).toContain('Over available capacity');
  });
  it('people without a skill are listed under “No skill”, after the skills', () => {
    const p = staffed(); p.resources.push({ id: 'r9', name: 'Zed', skillIds: [], fte: 1 });
    const shape = buildTable(p).rows.filter(r => r.kind === 'skill' || r.kind === 'person').map(r => r.label);
    expect(shape.slice(-2)).toEqual(['No skill', 'Zed']);
  });
  it('“Loading by skill” is the switch for the whole section; the people are a separate option inside it', () => {
    const p = staffed();
    expect(p.view.showResources).toBe(true); // on by default…
    p.view.showSkillSummary = false; // …yet unticking Loading by skill removes the section, people included
    const off = buildTable(p).rows;
    expect(off.some(r => r.id === 'sec:skills' || r.kind === 'skill' || r.kind === 'person')).toBe(false);
    p.view.showSkillSummary = true;
    expect(buildTable(p).rows.filter(r => r.kind === 'person')).toHaveLength(3);
    p.view.showResources = false; // people off: the skills stay, without the people
    const noPeople = buildTable(p).rows;
    expect(noPeople.filter(r => r.kind === 'skill').map(r => r.label)).toEqual(['Dev', 'QA']);
    expect(noPeople.some(r => r.kind === 'person')).toBe(false);
    p.view.showSkillSummary = false; // both off
    expect(buildTable(p).rows.some(r => r.id === 'sec:skills')).toBe(false);
  });
  it('the picture follows the two switches', () => {
    const p = staffed();
    const draw = () => renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg;
    expect(draw()).toContain('LOADING BY SKILL');
    expect(draw()).toContain('Bo (QA · 0.5 FTE)');
    p.view.showResources = false;
    expect(draw()).toContain('LOADING BY SKILL');
    expect(draw()).not.toContain('Bo (QA · 0.5 FTE)');
    p.view.showSkillSummary = false; p.view.showResources = true;
    expect(draw()).not.toContain('LOADING BY SKILL');
  });
  it('the people can be turned off, and are not repeated when rows are already grouped by resource', () => {
    const p = staffed(); p.view.showResources = false;
    expect(buildTable(p).rows.some(r => r.kind === 'person')).toBe(false);
    p.view.showResources = true; p.view.groupBy = 'resource';
    expect(buildTable(p).rows.some(r => r.kind === 'person')).toBe(false);
  });
  it('the Resource column appears when somebody is assigned, and not as an empty column otherwise', () => {
    const p = staffed();
    expect(buildTable(p).labelCols.map(c => c.id)).toContain('resource');
    expect(buildTable(p).rows.find(r => r.kind === 'row')!.resource).toContain('Alice');
    p.allocations.forEach(a => delete a.resourceId);
    expect(buildTable(p).labelCols.map(c => c.id)).not.toContain('resource');
  });
  it('the Excel workbook lists tasks and named resources too', () => {
    const p = withTasks(); p.resources = staffed().resources;
    p.view.showSkillSummary = true;
    p.allocations = [alloc({ taskId: 't1', resourceId: 'r1' })];
    const buf = exportXlsx(p, BUILTIN_THEMES[0], []);
    const text = new TextDecoder('latin1').decode(buf); // stored (uncompressed) ZIP: the XML is readable in place
    expect(text).toContain('Interviews');
    expect(text).toContain('Wireframes');
    expect(text).toContain('LOADING BY SKILL');
    expect(text).toContain('Alice');
  });
});

import { costDaily, costSummary, fmtMoney, fmtMoneyFull, hasRates, pmDaysAuto, pmDaysOf, rateOf } from '../src/cost';

describe('cost calculations', () => {
  /** One developer rate 100/day, one tester skill rate 60/day, on a weekly timeline from Mon 2026-03-02. */
  const priced = (): Project => {
    const p = weekly(4);
    p.cost.enabled = true; p.cost.currency = 'EUR';
    p.skills[0].dayRate = 100; p.skills[1].dayRate = 60;
    p.resources = [{ id: 'r1', name: 'Ann', skillIds: ['s1'], fte: 1, dayRate: 150 }, { id: 'r2', name: 'Bob', skillIds: ['s1'], fte: 1 }];
    return p;
  };
  it('person-month is the working days per week × 52 ÷ 12 unless set', () => {
    expect(pmDaysAuto([1, 2, 3, 4, 5])).toBe(21.67);
    expect(pmDaysAuto([1, 2, 3, 4, 5, 6])).toBe(26);
    expect(pmDaysAuto([0, 1, 2, 3, 4, 5, 6])).toBe(30.33);
    const p = priced();
    expect(pmDaysOf(p)).toBe(21.67);
    p.workDays = [1, 2, 3, 4];
    expect(pmDaysOf(p)).toBe(17.33); // follows the chosen working days
    p.cost.pmDays = 20;
    expect(pmDaysOf(p)).toBe(20); // the user's number wins
  });
  it('the resource’s own rate wins; otherwise the skill’s; otherwise nothing', () => {
    const p = priced();
    expect(rateOf(alloc({ resourceId: 'r1' }), p)).toMatchObject({ rate: 150, source: 'resource' });
    expect(rateOf(alloc({ resourceId: 'r2' }), p)).toMatchObject({ rate: 100, source: 'skill' }); // Bob has none: his skill's rate
    expect(rateOf(alloc({ skillId: 's2' }), p)).toMatchObject({ rate: 60, source: 'skill' });
    expect(rateOf(alloc({ resourceId: 'r2', skillId: '' }), p)).toMatchObject({ rate: 100, source: 'skill' }); // falls back to his primary skill
    expect(rateOf(alloc({ skillId: '' }), p)).toMatchObject({ rate: 0, source: 'none' });
    expect(hasRates(p)).toBe(true);
    expect(hasRates(weekly())).toBe(false);
  });
  it('cost is people × working days × rate; weekends and holidays are free', () => {
    const p = priced();
    p.allocations = [alloc({ count: 2, start: '2026-03-02', end: '2026-03-08' })]; // Mon..Sun: 5 working days, 2 people, 100/day
    const cal = calFor(p);
    expect(aggregate(costDaily(p.allocations, p, cal), cal, 'days')).toEqual([1000, 0, 0, 0]);
    const calH = calFor(p, ['2026-03-04']);
    expect(aggregate(costDaily(p.allocations, p, calH), calH, 'days')[0]).toBe(800);
    p.workDays = [1, 2];
    const cal2 = calFor(p);
    expect(aggregate(costDaily(p.allocations, p, cal2), cal2, 'days')[0]).toBe(400);
  });
  it('summary: person-days, person-months, cost, unpriced lines', () => {
    const p = priced(); p.cost.pmDays = 20;
    p.allocations = [
      alloc({ resourceId: 'r1', start: '2026-03-02', end: '2026-03-13' }), // Ann: 10 days @150
      alloc({ skillId: 's2', start: '2026-03-02', end: '2026-03-06' }), // 5 days @60
      alloc({ skillId: '', start: '2026-03-02', end: '2026-03-06', count: 2 }), // 10 person-days, no rate
    ];
    const s = costSummary(p, calFor(p));
    expect(s.totalPersonDays).toBe(25);
    expect(s.totalCost).toBe(10 * 150 + 5 * 60);
    expect(s.personMonths).toBe(1.25);
    expect(s.unpriced).toBe(1);
  });
  it('the table gets cost rows per group, a total and the effort in person-months', () => {
    const p = priced(); p.cost.pmDays = 20;
    p.allocations = [alloc({ workstreamId: 'w1', start: '2026-03-02', end: '2026-03-06' }), alloc({ workstreamId: 'w2', skillId: 's2', start: '2026-03-02', end: '2026-03-13', count: 2 })];
    const t = buildTable(p);
    const i = t.rows.findIndex(r => r.id === 'sec:cost');
    expect(t.rows[i].label).toBe('Cost (EUR)');
    const cost = t.rows.slice(i + 1);
    expect(cost.map(r => `${r.kind}:${r.label}`)).toEqual(['cost:Alpha', 'cost:Beta', 'costtotal:Total cost', 'cost:Effort (person-months)']);
    expect(cost[0].values.slice(0, 2)).toEqual([500, 0]);
    expect(cost[1].values.slice(0, 2)).toEqual([600, 600]);
    expect(cost[2].values.slice(0, 2)).toEqual([1100, 600]);
    expect(cost[2].total).toBe(1700);
    expect(cost[0].money && cost[2].money).toBe(true);
    expect(cost[3].money).toBeUndefined();
    expect(cost[3].values.slice(0, 2)).toEqual([0.75, 0.5]); // (5 + 10) / 20, 10 / 20
    expect(cost[3].total).toBe(1.25);
    expect(t.cost).toMatchObject({ currency: 'EUR', pmDays: 20, pmAuto: false, unpriced: 0 });
  });
  it('can be hidden, switched off, or left out of one render', () => {
    const p = priced(); p.allocations = [alloc({})];
    expect(buildTable(p).rows.some(r => r.kind === 'cost')).toBe(true);
    p.view.showCost = false;
    expect(buildTable(p).rows.some(r => r.id === 'sec:cost')).toBe(false); // hidden…
    expect(buildTable(p).cost).toBeUndefined();
    p.view.showCost = true;
    expect(buildTable(p, [], { cost: false }).rows.some(r => r.id === 'sec:cost')).toBe(false); // …or excluded from an export
    p.cost.enabled = false;
    expect(buildTable(p).rows.some(r => r.id === 'sec:cost')).toBe(false); // …or the feature is off (rates are kept)
    expect(p.skills[0].dayRate).toBe(100);
  });
  it('shows in the picture: money rows, currency and the person-month basis in the legend, unpriced warning', () => {
    const p = priced(); p.allocations = [alloc({}), alloc({ skillId: '' })];
    const svg = renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg;
    expect(svg).toContain('COST (EUR)');
    expect(svg).toContain('Total cost');
    expect(svg).toContain('500'); // 5 days × 100
    expect(svg).toContain('1 person-month = 21.67 working days (automatic)');
    expect(svg).toContain('1 resource line not priced');
    expect(renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false, cost: false }).svg).not.toContain('COST (EUR)');
    p.view.showCost = false;
    expect(renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg).not.toContain('Total cost');
  });
  it('formats money', () => {
    expect(fmtMoney(0)).toBe('0');
    expect(fmtMoney(999.6)).toBe('1,000');
    expect(fmtMoney(123456)).toBe('123,456');
    expect(fmtMoney(1250000)).toBe('1.25M');
    expect(fmtMoney(-2500)).toBe('−2,500');
    expect(fmtMoneyFull(12345.5)).toBe('12,345.5');
    expect(fmtMoneyFull(1000)).toBe('1,000');
  });
  it('rates and settings survive a save/load and junk is repaired', () => {
    const p = priced(); p.cost.pmDays = 18;
    const q = parseImport(JSON.stringify({ app: 'resource-loading-planner', project: p })).projects[0];
    expect(q.cost).toMatchObject({ enabled: true, currency: 'EUR', pmDays: 18 });
    expect(q.resources[0].dayRate).toBe(150);
    expect(q.skills[0].dayRate).toBe(100);
    const j = normalizeProject({ cost: { enabled: 'yes', currency: 12, pmDays: 99, exportSheet: 0 }, resources: [{ dayRate: -5 }, { dayRate: 'x' }, { dayRate: '75.555' }] });
    expect(j.cost).toEqual({ enabled: false, currency: 'USD', pmDays: 31, exportSheet: true, exportRows: true });
    expect(j.resources.map(r => r.dayRate)).toEqual([undefined, undefined, 75.56]);
    expect(normalizeProject({}).cost.enabled).toBe(false); // an old project has the feature off
  });
});

describe('cost in the Excel export', () => {
  const read = (buf: Uint8Array) => new TextDecoder('utf-8').decode(buf); // stored ZIP: the XML is readable in place
  const sheetNames = (x: string) => [...x.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  const proj = (): Project => {
    const p = sampleProject(); p.cost.enabled = true; p.cost.currency = 'EUR'; p.cost.pmDays = 20;
    return p;
  };
  it('is a separate sheet in the same workbook, with person-month formulas', () => {
    const x = read(exportXlsx(proj(), BUILTIN_THEMES[0], []));
    expect(sheetNames(x)).toEqual(['Loading plan', 'Cost', 'Allocations', 'Resources', 'Calendar']);
    expect(x).toContain('Working days in one person-month');
    expect(x).toContain('<f>C9*$B$4</f>'); // month rate = day rate × the person-month cell
    expect(x).toContain('<f>E9/$B$4</f>');
    expect(x).toContain('Cost per person-day (EUR)'); // also on the Resources sheet
    expect(x).toContain('Named resource — own rate');
    expect(x).toContain('Skill — standard rate');
  });
  it('the Cost sheet totals agree with the plan', () => {
    const p = proj();
    const sum = costSummary(p, buildCalendar(buildAxis(p), p.workDays, []));
    const x = read(exportXlsx(p, BUILTIN_THEMES[0], []));
    expect(x).toContain(`<v>${sum.totalCost}</v>`);
    const total = buildTable(p).rows.find(r => r.kind === 'costtotal')!;
    expect(total.total).toBeCloseTo(sum.totalCost, 2);
  });
  it('without the cost sheet nothing of it remains: no sheet, no rate column', () => {
    const x = read(exportXlsx(proj(), BUILTIN_THEMES[0], [], { costSheet: false, costRows: true }));
    expect(sheetNames(x)).toEqual(['Loading plan', 'Allocations', 'Resources', 'Calendar']);
    expect(x).not.toContain('Cost per person-day');
    expect(x).not.toContain('Working days in one person-month');
    expect(x).toContain('Total cost'); // the plan's cost rows were still asked for
  });
  it('without cost rows the plan sheet has none; with neither, the workbook is free of cost', () => {
    const x = read(exportXlsx(proj(), BUILTIN_THEMES[0], [], { costSheet: false, costRows: false }));
    expect(x).not.toContain('Total cost');
    expect(x).not.toContain('COST (EUR)');
    expect(x).not.toMatch(/person-month/i);
    expect(x).not.toContain('Cost per person-day');
    const only = read(exportXlsx(proj(), BUILTIN_THEMES[0], [], { costSheet: true, costRows: false }));
    expect(sheetNames(only)).toContain('Cost');
    expect(only).not.toContain('COST (EUR)'); // plan sheet has no cost rows
  });
  it('follows the project’s remembered choice by default, and nothing is exported when the feature is off', () => {
    const p = proj(); p.cost.exportSheet = false;
    expect(sheetNames(read(exportXlsx(p, BUILTIN_THEMES[0], [])))).not.toContain('Cost');
    const off = proj(); off.cost.enabled = false;
    const x = read(exportXlsx(off, BUILTIN_THEMES[0], [], { costSheet: true, costRows: true }));
    expect(sheetNames(x)).not.toContain('Cost');
    expect(x).not.toContain('Total cost');
  });
  it('every template and scale exports with cost on', () => {
    for (const tpl of TEMPLATES) for (const scale of ['week', 'quarter', 'year'] as const) {
      const p = proj(); p.scale = scale; p.startDate = periodStart(p.startDate, scale); p.periods = 6; applyTemplate(p, tpl);
      expect(() => exportXlsx(p, BUILTIN_THEMES.find(t => t.id === p.themeId)!, [])).not.toThrow();
      expect(renderPlan(p, BUILTIN_THEMES.find(t => t.id === p.themeId)!, [], { interactive: true }).svg).not.toContain('NaN');
    }
  });
});

describe('Cost sheet headers', () => {
  it('keeps the Work stream / Total labels when the period header has a group row above it', () => {
    const p = sampleProject(); p.cost.enabled = true; // monthly columns grouped under years => two header rows
    const x = new TextDecoder('utf-8').decode(exportXlsx(p, BUILTIN_THEMES[0], []));
    const sheet = x.slice(x.indexOf('Rates and totals'));
    expect(sheet).toMatch(/<c r="A1[0-9]"[^>]*t="inlineStr"><is><t[^>]*>Work stream<\/t>/);
    expect(sheet).toMatch(/<c r="[A-Z]+1[0-9]"[^>]*t="inlineStr"><is><t[^>]*>Total<\/t>/);
  });
});

import { CURRENCIES, currencyOf, excelMoneyFormat, fmtPlain, isKnownCurrency } from '../src/cost';

describe('currencies', () => {
  it('has a selection of currencies with unique codes', () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(CURRENCIES.map(c => c.code)).size).toBe(CURRENCIES.length);
    expect(isKnownCurrency('EUR')).toBe(true);
    expect(isKnownCurrency('$')).toBe(false);
  });
  it('writes amounts with their currency', () => {
    expect(fmtMoney(343000, 'USD')).toBe('$343,000');
    expect(fmtMoney(343000, 'EUR')).toBe('€343,000');
    expect(fmtMoney(1250000, 'GBP')).toBe('£1.25M');
    expect(fmtMoney(12000, 'SEK')).toBe('12,000 kr'); // some currencies go after the amount
    expect(fmtMoney(12000, 'CHF')).toBe('CHF 12,000');
    expect(fmtMoney(-2500, 'USD')).toBe('−$2,500');
    expect(fmtMoney(0, 'USD')).toBe('$0');
    expect(fmtMoney(500)).toBe('500'); // no currency given: just the number
  });
  it('writes a rate with its decimals, and yen / won without', () => {
    expect(fmtMoneyFull(450, 'USD')).toBe('$450');
    expect(fmtMoneyFull(12345.5, 'USD')).toBe('$12,345.50');
    expect(fmtMoneyFull(9000.4, 'JPY')).toBe('¥9,000');
    expect(fmtMoneyFull(1234.56, 'INR')).toBe('₹1,234.56');
    expect(fmtPlain(21.67)).toBe('21.67'); // quantities never get a currency
    expect(fmtPlain(1704)).toBe('1,704');
  });
  it('a custom currency is the user’s own text', () => {
    expect(fmtMoney(500, 'XYZ')).toBe('XYZ 500');
    expect(fmtMoney(500, '¤')).toBe('¤500');
    expect(fmtMoney(500, '')).toBe('500'); // none: plain numbers
    expect(currencyOf('').symbol).toBe('');
  });
  it('gives Excel a matching number format', () => {
    expect(excelMoneyFormat('USD', 0)).toBe('"$"#,##0');
    expect(excelMoneyFormat('EUR', 2)).toBe('"€"#,##0.00');
    expect(excelMoneyFormat('SEK', 2)).toBe('#,##0.00" kr"');
    expect(excelMoneyFormat('JPY', 2)).toBe('"¥"#,##0');
    expect(excelMoneyFormat('', 2)).toBe('#,##0.00');
  });
  const euro = (): Project => { const p = sampleProject(); p.cost.enabled = true; p.cost.currency = 'EUR'; p.cost.pmDays = 20; return p; };
  it('every cost figure in the table and the picture carries the currency', () => {
    const t = buildTable(euro());
    const money = t.rows.filter(r => r.money);
    expect(money.length).toBeGreaterThan(2);
    const svg = renderPlan(euro(), BUILTIN_THEMES[0], [], { interactive: true }).svg;
    expect(svg).toContain('€343,000'); // Backend's total
    expect(svg).toContain(fmtMoney(t.rows.find(r => r.kind === 'costtotal')!.total!, 'EUR')); // the grand total
    expect(svg).toMatch(/>€31,900</);
    expect(svg).not.toMatch(/>31,900</);
    expect(svg).toContain('cost = people × working days × cost per person-day'); // tooltips carry the working
    expect(svg).toContain('4.4'); // effort in person-months is a quantity: no currency
    expect(svg).not.toContain('€4.4');
  });
  it('the Excel workbook formats cost cells, rates and totals in the currency', () => {
    const x = new TextDecoder('utf-8').decode(exportXlsx(euro(), BUILTIN_THEMES[0], []));
    expect(x).toContain('formatCode="&quot;€&quot;#,##0"'); // plan sheet and period matrix
    expect(x).toContain('formatCode="&quot;€&quot;#,##0.00"'); // rate card and the Resources sheet's rate column
    const sek = euro(); sek.cost.currency = 'SEK';
    expect(new TextDecoder('utf-8').decode(exportXlsx(sek, BUILTIN_THEMES[0], []))).toContain('formatCode="#,##0&quot; kr&quot;"');
  });
});

import { resourceLabel, resourcesWithSkill } from '../src/model';

describe('resources and their skills', () => {
  const p = (): Project => {
    const x = weekly();
    x.resources = [
      { id: 'r1', name: 'Alice', skillIds: ['s1', 's2'], fte: 1 }, { id: 'r2', name: 'Bo', skillIds: ['s2'], fte: 0.5 },
      { id: 'r3', name: 'Cy', skillIds: ['s1'], fte: 1 }, { id: 'r4', name: 'Di', skillIds: [], fte: 1 },
    ];
    return x;
  };
  it('a resource is named with their skills, and their availability when not full time', () => {
    const x = p();
    expect(resourceLabel(x.resources[0], x.skills)).toBe('Alice (Dev, QA)');
    expect(resourceLabel(x.resources[1], x.skills)).toBe('Bo (QA)');
    expect(resourceLabel(x.resources[1], x.skills, true)).toBe('Bo (QA · 0.5 FTE)');
    expect(resourceLabel(x.resources[3], x.skills)).toBe('Di');
    expect(resourceLabel({ name: 'Eve', skillIds: [], fte: 0.5 }, [], true)).toBe('Eve (0.5 FTE)');
  });
  it('lines can be given only to resources who have the line’s skill', () => {
    const x = p();
    expect(resourcesWithSkill(x, 's1').map(r => r.name)).toEqual(['Alice', 'Cy']); // any of a person's skills counts, not only the primary
    expect(resourcesWithSkill(x, 's2').map(r => r.name)).toEqual(['Alice', 'Bo']);
    expect(resourcesWithSkill(x, '').map(r => r.name)).toEqual(['Alice', 'Bo', 'Cy', 'Di']); // no skill chosen yet: everyone
    expect(resourcesWithSkill(x, 'none')).toEqual([]);
  });
  it('the table names resources with their skills everywhere: Resource column, line rows, resource groups', () => {
    const x = p();
    x.allocations = [alloc({ resourceId: 'r1' }), alloc({ skillId: 's2', resourceId: 'r2', count: 0.5 })];
    const t = buildTable(x);
    expect(t.rows.find(r => r.kind === 'row' && r.label === 'Dev')!.resource).toBe('Alice (Dev, QA)');
    x.view.detail = 'lines';
    expect(buildTable(x).rows.filter(r => r.kind === 'row').map(r => r.label)).toEqual(['Alice (Dev, QA)', 'Bo (QA)']);
    x.view.groupBy = 'resource';
    expect(buildTable(x).rows.filter(r => r.kind === 'group').map(r => r.label)).toEqual(['Alice (Dev, QA)', 'Bo (QA)']);
  });
  it('the Excel workbook names resources with their skills in the data sheets and the rate card', () => {
    const x = p(); x.cost.enabled = true; x.resources[0].dayRate = 400;
    x.allocations = [alloc({ resourceId: 'r1' })];
    const xml = new TextDecoder('utf-8').decode(exportXlsx(x, BUILTIN_THEMES[0], []));
    expect(xml.match(/Alice \(Dev, QA\)/g)!.length).toBeGreaterThanOrEqual(3); // plan sheet, allocations sheet, rate card
  });
});

describe('the working behind a cost figure (hover text)', () => {
  const proj = (): Project => {
    const p = weekly(3);
    p.cost.enabled = true; p.cost.currency = 'EUR'; p.cost.pmDays = 20;
    p.skills[0].dayRate = 100;
    p.resources = [{ id: 'r1', name: 'Ann', skillIds: ['s1'], fte: 1, dayRate: 150 }];
    p.allocations = [
      alloc({ count: 2, start: '2026-03-02', end: '2026-03-06' }), // 2 × 5 × 100 = 1,000
      alloc({ resourceId: 'r1', start: '2026-03-02', end: '2026-03-13' }), // Ann: 150/day, 5 days in week 1 and 5 in week 2
      alloc({ skillId: 's2', count: 1, start: '2026-03-02', end: '2026-03-06' }), // no rate for QA
    ];
    return p;
  };
  const row = (id: string) => buildTable(proj()).rows.find(r => r.id === id)!;
  it('a period cell lists each line as people × days × rate = cost, then the total', () => {
    const r = buildTable(proj()).rows.find(x => x.kind === 'cost' && x.label === 'Alpha')!;
    const w1 = r.explain!(0).split('\n');
    expect(w1[0]).toBe('Alpha · W10 (week of 2 Mar 2026)');
    expect(w1[1]).toBe('cost = people × working days × cost per person-day');
    expect(w1).toContain('Dev: 2 × 5 days × €100 = €1,000 (skill rate)');
    expect(w1).toContain('Dev (Ann): 1 × 5 days × €150 = €750 (resource rate)'); // the named resource's own rate
    expect(w1).toContain('QA: 1 × 5 days — no rate, not priced'); // unpriced lines are called out, not hidden
    expect(w1[w1.length - 1]).toBe(`Total: €${(1750).toLocaleString('en-US')}`);
    expect(r.values[0]).toBe(1750);
  });
  it('only lines that are loaded in that period are listed', () => {
    const r = buildTable(proj()).rows.find(x => x.kind === 'cost' && x.label === 'Alpha')!;
    const w2 = r.explain!(1).split('\n');
    expect(w2.filter(l => l.includes('×')).length).toBe(2); // the rule line + Ann's line; the others end in week 1
    expect(w2.join('\n')).toContain('Dev (Ann): 1 × 5 days × €150');
    expect(r.explain!(2)).toContain('nothing is loaded');
  });
  it('the totals column explains the whole timeline', () => {
    const r = buildTable(proj()).rows.find(x => x.kind === 'cost' && x.label === 'Alpha')!;
    const all = r.explain!(null);
    expect(all).toContain('the whole timeline');
    expect(all).toContain('Dev (Ann): 1 × 10 days × €150 = €1,500');
    expect(all).toContain('Total: €2,500');
  });
  it('part-time people are written as they are loaded', () => {
    const p = proj(); p.allocations = [alloc({ count: 0.5, start: '2026-03-02', end: '2026-03-06' })];
    expect(buildTable(p).rows.find(x => x.kind === 'cost')!.explain!(0)).toContain('Dev: 0.5 × 5 days × €100 = €250');
  });
  it('the total row lists the groups it adds up, and the effort row shows the division', () => {
    const total = row('cost:total').explain!(0);
    expect(total).toContain('Total cost · W10 (week of 2 Mar 2026)');
    expect(total).toContain('Alpha: €1,750');
    expect(total).not.toContain('Beta: €0'); // groups with nothing in that period are left out
    expect(total).toContain('Total: €1,750');
    expect(total).toContain('1 resource line has no rate and is not included');
    const effort = row('cost:effort').explain!(0);
    expect(effort).toContain('20 person-days ÷ 20 working days per person-month'); // all loaded lines count, priced or not
    expect(effort).toContain('= 1 person-month');
    expect(row('cost:effort').explain!(null)).toContain('(person-month length set under Cost)');
  });
  it('month names carry their year, and relative columns just their label', () => {
    const p = proj(); p.scale = 'month'; p.startDate = '2026-03-01'; p.periods = 2;
    expect(buildTable(p).rows.find(x => x.kind === 'cost')!.explain!(0).split('\n')[0]).toMatch(/· Mar 2026$/);
    setUseDates(p, false);
    expect(buildTable(p).rows.find(x => x.kind === 'cost')!.explain!(0).split('\n')[0]).toMatch(/· M1$/);
  });
  it('shows in the preview’s hover text, for cells and the totals column — and not in exports', () => {
    const p = proj();
    const live = renderPlan(p, BUILTIN_THEMES[0], [], { interactive: true }).svg;
    expect(live).toContain('Dev (Ann): 1 × 5 days × €150 = €750 (resource rate)');
    expect(live).toContain('Dev (Ann): 1 × 10 days × €150 = €1,500'); // the totals column
    expect(live).toContain('20 person-days ÷ 20 working days per person-month');
    const exported = renderPlan(p, BUILTIN_THEMES[0], [], { interactive: false }).svg;
    expect(exported).not.toContain('<title>');
    expect(exported).not.toContain('resource rate');
  });
  it('long lists are cut off sensibly', () => {
    const p = proj(); p.allocations = Array.from({ length: 20 }, () => alloc({ start: '2026-03-02', end: '2026-03-06' }));
    const lines = buildTable(p).rows.find(x => x.kind === 'cost')!.explain!(0).split('\n');
    expect(lines.some(l => l === '… and 6 more lines')).toBe(true);
  });
});
