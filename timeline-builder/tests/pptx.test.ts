import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/zip';
import { XNode, parseXml } from '../src/xml';
import { exportPptx, parsePath, pickFont, svgToPptx } from '../src/pptx';
import { TEMPLATES, applyTemplate } from '../src/templates';
import { BUILTIN_THEMES } from '../src/themes';
import { sampleProject, setUseDates } from '../src/model';
import { renderTimeline } from '../src/render';
import { periodStart } from '../src/dates';

/** Reads the central directory of a stored ZIP, checking every CRC on the way. */
function readZip(buf: Uint8Array): Record<string, string> {
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
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nl;
  }
  return out;
}

const svgFor = (tplId: string, scale: 'week' | 'month' | 'quarter' | 'year' = 'month', rel = false) => {
  const tpl = TEMPLATES.find(t => t.id === tplId)!;
  const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale); p.showDates = true; p.currentPeriod = 2;
  if (rel) setUseDates(p, false);
  applyTemplate(p, tpl);
  const theme = BUILTIN_THEMES.find(t => t.id === p.themeId)!;
  return { p, theme, svg: renderTimeline(p, theme, { interactive: false, holidays: [{ date: p.startDate, name: 'H' }] }).svg };
};

describe('xml reader', () => {
  it('reads elements, attributes, text and entities', () => {
    const n = parseXml('<svg a="1 &amp; 2"><g><text x="1">A &lt; B &#38; &quot;C&quot;</text><rect/></g></svg>');
    expect(n.tag).toBe('svg');
    expect(n.attrs.a).toBe('1 & 2');
    expect(n.children[0].children[0].text).toBe('A < B & "C"');
    expect(n.children[0].children[1].tag).toBe('rect');
  });
  it('rejects broken markup', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(() => parseXml('<a>')).toThrow();
    expect(() => parseXml('')).toThrow();
  });
});

describe('paths', () => {
  it('reads M L H V Z, absolute and relative', () => {
    expect(parsePath('M10 20H30V40L50 60Z')).toEqual([{ pts: [[10, 20], [30, 20], [30, 40], [50, 60]], closed: true }]);
    expect(parsePath('M0 0V10M5 0V10')).toHaveLength(2);
    expect(parsePath('M1 1l2 0 0 3z')[0].pts).toEqual([[1, 1], [3, 1], [3, 4]]);
    expect(parsePath('M1 1 2 2 3 1')[0].pts).toHaveLength(3); // pairs after a move are lines
  });
  it('survives junk without looping', () => {
    expect(parsePath('')).toEqual([]);
    expect(parsePath('Z 5 5 5')).toEqual([]);
    expect(parsePath('M 1 1 C 1 2 3 4 5 6 L 9 9')[0].pts.at(-1)).toEqual([9, 9]);
  });
});

describe('fonts', () => {
  it('picks something PowerPoint has', () => {
    expect(pickFont('-apple-system, "Segoe UI", Helvetica, Arial, sans-serif')).toBe('Arial');
    expect(pickFont('Georgia, "Times New Roman", serif')).toBe('Georgia');
    expect(pickFont('ui-monospace, Menlo, Consolas, monospace')).toBe('Menlo');
    expect(pickFont('ui-monospace, monospace')).toBe('Consolas');
    expect(pickFont('')).toBe('Arial');
  });
});

describe('PowerPoint export: the chart is sized to a standard slide', () => {
  const SW = 12192000, SH = 6858000;
  const deck = (tplId: string, scale: 'week' | 'month' | 'quarter' | 'year' = 'month', extraItems = 0, periods?: number) => {
    const tpl = TEMPLATES.find(t => t.id === tplId)!;
    const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale); p.showDates = true;
    if (periods) p.periods = periods;
    for (let i = 0; i < extraItems; i++) p.items.push({ ...p.items[1], id: 'x' + i, name: 'Extra task ' + i });
    applyTemplate(p, tpl);
    const theme = BUILTIN_THEMES.find(t => t.id === p.themeId)!;
    const holidays = [{ date: p.startDate, name: 'H' }];
    return { p, theme, holidays, bytes: exportPptx(p, theme, holidays), plain: renderTimeline(p, theme, { interactive: false, holidays }) };
  };
  /** The slide size and how far the (unrotated) content reaches across it. */
  const extent = (bytes: Uint8Array) => {
    const z = readZip(bytes);
    const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(z['ppt/presentation.xml'])!;
    const xs: number[] = [], ys: number[] = [];
    for (const m of z['ppt/slides/slide1.xml'].matchAll(/<a:xfrm(?![^>]*rot=)[^>]*><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)) {
      if (+m[3] === 0 && +m[4] === 0) continue;
      xs.push(+m[1], +m[1] + +m[3]); ys.push(+m[2], +m[2] + +m[4]);
    }
    return { w: +sz[1], h: +sz[2], left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  };

  it('the slide is always the standard 16:9, 13.33 x 7.5 in, whatever the chart looks like', () => {
    for (const [tpl, scale, extra] of [['corporate', 'week', 0], ['corporate', 'year', 0], ['tpl-blue-modern', 'quarter', 25], ['tpl-multi-overview', 'week', 40]] as const) {
      const e = extent(deck(tpl, scale, extra).bytes);
      expect([e.w, e.h], `${tpl}/${scale}/${extra}`).toEqual([SW, SH]);
    }
  });

  it('the chart runs edge to edge for every template and scale: it starts and ends at the slide sides', () => {
    for (const tpl of TEMPLATES) for (const scale of ['week', 'month', 'quarter', 'year'] as const) {
      const e = extent(deck(tpl.id, scale).bytes);
      const pad = SW * 0.03; // the drawing keeps its own thin padding; nothing more than that is left empty at the sides
      expect(e.left, `${tpl.id}/${scale} left`).toBeLessThanOrEqual(pad);
      expect(e.right, `${tpl.id}/${scale} right`).toBeGreaterThanOrEqual(SW - pad);
      expect(e.left, `${tpl.id}/${scale} left`).toBeGreaterThanOrEqual(-12700);
      expect(e.right, `${tpl.id}/${scale} right`).toBeLessThanOrEqual(SW + 12700);
      expect(e.bottom, `${tpl.id}/${scale} bottom`).toBeLessThanOrEqual(SH + 12700);
      expect(e.top, `${tpl.id}/${scale} top`).toBeGreaterThanOrEqual(-12700);
    }
  });

  it('a tall chart gets wider time columns, so it fills the slide in both directions instead of leaving bands at the sides', () => {
    const d = deck('corporate', 'month', 20); // many rows: much taller than 16:9
    expect(d.plain.width / d.plain.height).toBeLessThan(16 / 9 - 0.1);
    const wide = renderTimeline(d.p, d.theme, { interactive: false, holidays: d.holidays, colScale: 2 });
    expect(wide.axis.width).toBeCloseTo(d.plain.axis.width * 2, 5);
    expect(wide.height).toBeCloseTo(d.plain.height, -1); // rows do not change, only the columns
    // a plain scale-to-fit would only reach about this far across; the export reaches the sides
    const plainReach = d.plain.width * (SH / d.plain.height);
    expect(plainReach).toBeLessThan(SW * 0.85);
    const e = extent(d.bytes);
    expect(e.right - e.left).toBeGreaterThan(SW * 0.95);
    expect(e.bottom - e.top).toBeGreaterThan(SH * 0.9);
  });

  it('a wide chart is fitted to the slide width as it is: same columns, same header, same legend; the spare room is left above and below', () => {
    const d = deck('corporate', 'week', 0, 52);
    expect(d.plain.width / d.plain.height).toBeGreaterThan(16 / 9 + 0.5);
    const size = (bytes: Uint8Array) => +/sz="(\d+)"/.exec(readZip(bytes)['ppt/slides/slide1.xml'].split('<p:sp>').find(s => s.includes('<a:t>Stakeholder interviews</a:t>'))!)![1];
    expect(size(d.bytes)).toBe(size(svgToPptx(d.plain.svg))); // nothing was re-laid out: the text is as big as a plain scale-to-fit gives
    const e = extent(d.bytes);
    expect(e.right - e.left).toBeGreaterThan(SW * 0.95);
    expect(e.bottom - e.top).toBeLessThan(SH * 0.8);
  });

  it('the columns are only ever stretched, within a limit, and an ordinary 16:9 chart is left alone', () => {
    const tall = deck('corporate', 'month', 60); // would need far more than the limit
    const e = extent(tall.bytes);
    expect(e.bottom - e.top).toBeGreaterThan(SH * 0.9); // it still fills the height…
    expect(e.right - e.left).toBeLessThan(SW * 0.98); // …but the stretch stops at the limit, so it does not reach both sides
    const candidates = [6, 7, 8, 9, 10, 11, 12, 13, 14].map(n => deck('corporate', 'month', 0, n));
    const near = candidates.sort((x, y) => Math.abs(x.plain.width / x.plain.height - 16 / 9) - Math.abs(y.plain.width / y.plain.height - 16 / 9))[0];
    expect(Math.abs(near.plain.width / near.plain.height - 16 / 9)).toBeLessThan(0.06);
    const textSize = (bytes: Uint8Array) => +/sz="(\d+)"/.exec(readZip(bytes)['ppt/slides/slide1.xml'].split('<p:sp>').find(s => s.includes('<a:t>Stakeholder interviews</a:t>'))!)![1];
    expect(Math.abs(textSize(near.bytes) - textSize(svgToPptx(near.plain.svg))) / textSize(near.bytes)).toBeLessThan(0.02);
  });

  it('stays editable: still shapes and text boxes, with the item names present', () => {
    const d = deck('corporate', 'month', 20);
    const slide = readZip(d.bytes)['ppt/slides/slide1.xml'];
    expect(slide).not.toContain('<p:pic>');
    for (const it of d.p.items) expect(slide, it.name).toContain(`<a:t>${it.name.replace(/&/g, '&amp;')}</a:t>`);
  });
});

describe('PowerPoint export', () => {
  it('is a well-formed package with the parts PowerPoint needs', () => {
    const z = readZip(svgToPptx(svgFor('corporate').svg, { title: 'Plan & <Co>' }));
    expect(Object.keys(z).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/presentation.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideMasters/slideMaster1.xml', 'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/slide1.xml', 'ppt/theme/theme1.xml']);
    for (const [name, xml] of Object.entries(z)) { expect(xml.startsWith('<?xml'), name).toBe(true); expect(() => parseXml(xml), name).not.toThrow(); }
    expect(z['docProps/core.xml']).toContain('Plan &amp; &lt;Co&gt;');
    expect(z['ppt/presentation.xml']).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    // every relationship target exists, and every part is declared
    for (const [rels, base] of [['_rels/.rels', ''], ['ppt/_rels/presentation.xml.rels', 'ppt/'], ['ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideMasters/'], ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slideLayouts/'], ['ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/']]) {
      for (const m of z[rels].matchAll(/Target="([^"]+)"/g)) {
        const parts = (base + m[1]).split('/'); const out: string[] = [];
        for (const s of parts) s === '..' ? out.pop() : out.push(s);
        expect(z[out.join('/')], `${rels} -> ${m[1]}`).toBeDefined();
      }
    }
    for (const part of ['/ppt/presentation.xml', '/ppt/slides/slide1.xml', '/ppt/slideMasters/slideMaster1.xml', '/ppt/slideLayouts/slideLayout1.xml', '/ppt/theme/theme1.xml']) expect(z['[Content_Types].xml']).toContain(`PartName="${part}"`);
  });

  it('turns every template, at every scale, into shapes without broken numbers', () => {
    for (const tpl of TEMPLATES) for (const scale of ['week', 'month', 'quarter', 'year'] as const) for (const rel of [false, true]) {
      const { svg } = svgFor(tpl.id, scale, rel);
      const slide = readZip(svgToPptx(svg))['ppt/slides/slide1.xml'];
      const tag = `${tpl.id}|${scale}|${rel}`;
      expect(slide, tag).not.toMatch(/NaN|undefined|Infinity/);
      const slideH = 6858000;
      const root = parseXml(slide);
      const tree = root.children.find(c => c.tag === 'p:cSld')!.children.find(c => c.tag === 'p:spTree')!;
      const shapes = tree.children.filter(c => c.tag === 'p:sp' || c.tag === 'p:cxnSp');
      expect(shapes.length, tag).toBeGreaterThan(40);
      // ids are unique, offsets and sizes are whole non-negative numbers, and nothing sits outside the slide
      const ids = shapes.map(s => s.children[0].children[0].attrs.id);
      expect(new Set(ids).size, tag).toBe(ids.length);
      for (const sp of shapes) {
        const xf = sp.children.find(c => c.tag === 'p:spPr')!.children.find(c => c.tag === 'a:xfrm')!;
        const off = xf.children.find(c => c.tag === 'a:off')!.attrs, ext = xf.children.find(c => c.tag === 'a:ext')!.attrs;
        for (const v of [off.x, off.y, ext.cx, ext.cy]) expect(v, tag).toMatch(/^-?\d+$/);
        expect(+ext.cx, tag).toBeGreaterThanOrEqual(0);
        expect(+ext.cy, tag).toBeGreaterThanOrEqual(0);
        if (!xf.attrs.rot) { expect(+off.x + +ext.cx, tag).toBeLessThanOrEqual(12192000 + 12700); expect(+off.y + +ext.cy, tag).toBeLessThanOrEqual(slideH + 12700); expect(+off.x, tag).toBeGreaterThanOrEqual(-12700); expect(+off.y, tag).toBeGreaterThanOrEqual(-12700); }
      }
    }
  });

  it('keeps every item as editable text and a native shape, not a picture', () => {
    const { svg, p } = svgFor('corporate');
    const slide = readZip(svgToPptx(svg))['ppt/slides/slide1.xml'];
    expect(slide).not.toContain('<p:pic>');
    for (const it of p.items) expect(slide, it.name).toContain(`<a:t>${it.name.replace(/&/g, '&amp;')}</a:t>`);
    expect(slide).toContain('<a:prstGeom prst="rect">');
    expect(slide).toContain('<a:custGeom>'); // phase brackets and markers are freeform shapes
    expect(readZip(svgToPptx(svgFor('minimal').svg))['ppt/slides/slide1.xml']).toContain('<a:prstGeom prst="ellipse">'); // circle markers
  });

  it('positions things where the drawing has them: the same shapes in the same relative places', () => {
    const { svg } = svgFor('corporate');
    const tree = parseXml(svg);
    const [, , W, H] = tree.attrs.viewBox.split(' ').map(Number);
    const k = Math.min(12192000 / W, 6858000 / H); // scaled to fit the standard slide, centred
    const ox = (12192000 - W * k) / 2, oy = (6858000 - H * k) / 2;
    const slide = parseXml(readZip(svgToPptx(svg))['ppt/slides/slide1.xml']);
    const sps = slide.children[0].children.find(c => c.tag === 'p:spTree')!.children.filter(c => c.tag === 'p:sp');
    // the first body text box: "Stakeholder interviews", left-aligned at the label column
    const label = tree.children.find(c => c.tag === 'text' && c.text === 'Stakeholder interviews')!;
    const sp = sps.find(s => s.children[0].children[0].attrs.name === 'Text: Stakeholder interviews')!;
    const off = sp.children[1].children[0].children[0].attrs;
    expect(+off.x).toBe(Math.round(ox + +label.attrs.x * k));
    const fs = +label.attrs['font-size'];
    expect(+off.y).toBe(Math.round(oy + (+label.attrs.y - fs * 0.905) * k)); // the baseline is placed where the drawing has it
    // a bar: its rectangle keeps its colour and corner rounding
    const bar = tree.children.find(c => c.tag === 'g' && c.children.some(k2 => k2.tag === 'rect' && k2.attrs.fill === '#3b82f6'))!.children.find(k2 => k2.tag === 'rect' && k2.attrs.fill === '#3b82f6')!;
    const barSp = sps.find(s => { const xf = s.children[1].children[0].children[0].attrs, e = s.children[1].children[0].children[1].attrs; return +xf.x === Math.round(ox + +bar.attrs.x * k) && +xf.y === Math.round(oy + +bar.attrs.y * k) && +e.cx === Math.round(+bar.attrs.width * k); })!;
    expect(barSp).toBeDefined();
    expect(JSON.stringify(barSp)).toContain('3B82F6');
    expect(JSON.stringify(barSp)).toContain('roundRect');
  });

  it('uses the page colour as the slide background instead of a rectangle in the way', () => {
    const { svg, theme } = svgFor('dark');
    const slide = readZip(svgToPptx(svg))['ppt/slides/slide1.xml'];
    expect(slide).toContain(`<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${theme.colors.bg.slice(1).toUpperCase()}"/>`);
    const n = (slide.match(/<p:sp>/g) ?? []).length;
    expect(n).toBeGreaterThan(30);
  });

  it('keeps gradients, stripes, dashes, opacity and rotated text', () => {
    expect(readZip(svgToPptx(svgFor('dark').svg))['ppt/slides/slide1.xml']).toContain('<a:gradFill');
    expect(readZip(svgToPptx(svgFor('contrast').svg))['ppt/slides/slide1.xml']).toContain('<a:pattFill prst="wdUpDiag">');
    // the exact dash pattern, relative to the line width: the legend's "Today" line is `3 2` at width 2, i.e. 150% on and 100% off
    expect(readZip(svgToPptx(svgFor('blueprint').svg))['ppt/slides/slide1.xml']).toContain('<a:custDash><a:ds d="150000" sp="100000"/></a:custDash>');
    expect(readZip(svgToPptx(svgFor('corporate').svg))['ppt/slides/slide1.xml']).toContain('<a:alpha val="');
    const side = readZip(svgToPptx(svgFor('tpl-orange-purple').svg))['ppt/slides/slide1.xml']; // vertical phase pills
    expect(side).toMatch(/<a:xfrm rot="16200000">/);
  });

  it('writes text safely', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" font-family="Arial"><rect width="200" height="100" fill="#fff000"/><text x="10" y="20" font-size="12" fill="#111111">R&amp;D &lt;phase&gt; &quot;1&quot;</text></svg>';
    const slide = readZip(svgToPptx(svg))['ppt/slides/slide1.xml'];
    expect(slide).toContain('<a:t>R&amp;D &lt;phase&gt; &quot;1&quot;</a:t>');
    expect(slide).toContain('val="FFF000"'); // the first full-size rectangle became the background
    expect(() => svgToPptx('<html/>')).toThrow(/SVG/);
  });
});

describe('PowerPoint export: the legend looks as in the app, on a single line', () => {
  /** The legend's own entries (the page title is drawn after the legend and is not one of them). The boxes legend may shorten a label with …. */
  const isEntry = (s: string) => /^(Task$|Completed por|Phase|Milestone|Gate|Holiday|Public|Weekend|Today|Done$|In progress|To do|Custom legend)/.test(s);
  interface Pos { text: string; x: number; y: number }
  const flat = (n: XNode): XNode[] => n.children.flatMap(c => (c.tag === 'g' ? flat(c) : [c]));
  /** Entries come after the last chart row (the last item is "Go-live"), which tells them apart from a column heading that happens to be called "Task". */
  const afterLastRow = <T extends { text: string }>(xs: T[]): T[] => { const last = xs.map(x => x.text).reduce((m, s, i) => (/^Go-live/.test(s) ? i : m), -1); return xs.slice(last + 1); };
  const svgLegend = (svg: string): Pos[] => afterLastRow(flat(parseXml(svg)).filter(n => n.tag === 'text' && n.text).map(n => ({ text: n.text, x: +n.attrs.x, y: +n.attrs.y }))).filter(n => isEntry(n.text));
  const slideTexts = (bytes: Uint8Array): Pos[] => afterLastRow(readZip(bytes)['ppt/slides/slide1.xml'].split('<p:sp>').slice(1)
    .map(s => ({ x: +/<a:off x="(-?\d+)"/.exec(s)![1], y: +/<a:off x="-?\d+" y="(-?\d+)"/.exec(s)![1], text: (/<a:t>([^<]*)<\/a:t>/.exec(s)?.[1] ?? '').replace(/&amp;/g, '&') }))
    .filter(s => s.text)).filter(s => isEntry(s.text));
  const rowsOf = (ps: Pos[]) => new Set(ps.map(p => p.y)).size;

  const project = (tplId: string, scale: 'week' | 'month' | 'quarter' | 'year', extraItems: number, entries: number, position: 'bottom' | 'top' | 'right' = 'bottom') => {
    const p = sampleProject(); p.scale = scale; p.startDate = periodStart(p.startDate, scale); p.showDates = true; p.legend.position = position;
    for (let i = 0; i < extraItems; i++) p.items.push({ ...p.items[1], id: 'x' + i, name: 'Extra ' + i });
    for (let i = 0; i < entries; i++) p.legend.custom.push({ label: 'Custom legend entry ' + (i + 1), color: '#8b5cf6' });
    applyTemplate(p, TEMPLATES.find(t => t.id === tplId)!);
    const theme = BUILTIN_THEMES.find(t => t.id === p.themeId)!;
    return { p, theme, holidays: [{ date: p.startDate, name: 'H' }] };
  };

  it('a legend that wraps in the app runs along fewer rows once the chart is wider, down to a single row', () => {
    const { p, theme, holidays } = project('corporate', 'month', 18, 6);
    const app = renderTimeline(p, theme, { interactive: false, holidays });
    expect(rowsOf(svgLegend(app.svg))).toBeGreaterThanOrEqual(2); // it wraps in the app
    const wide = renderTimeline(p, theme, { interactive: false, holidays, colScale: 3, horizontalLegend: true });
    expect(rowsOf(svgLegend(wide.svg))).toBe(1);
    expect(wide.height).toBeLessThan(app.height); // the legend takes less room
    expect(rowsOf(slideTexts(exportPptx(p, theme, holidays)))).toBe(1);
  });

  it('an ordinary legend is a single row in the export', () => {
    for (const tpl of ['corporate', 'modern', 'dark']) {
      const { p, theme, holidays } = project(tpl, 'month', 0, 0);
      expect(rowsOf(slideTexts(exportPptx(p, theme, holidays))), tpl).toBe(1);
    }
    // even a template with more entries (status colours) stays on one line: the gaps between entries tighten, or the chart widens a little
    const { p, theme, holidays } = project('tpl-blue-modern', 'month', 0, 3);
    expect(rowsOf(slideTexts(exportPptx(p, theme, holidays)))).toBe(1);
  });

  it('a legend placed at the side goes below the chart, in rows, and the chart is not made wider for it', () => {
    const { p, theme, holidays } = project('corporate', 'month', 0, 2, 'right');
    const app = renderTimeline(p, theme, { interactive: false, holidays });
    const appLegend = svgLegend(app.svg);
    expect(rowsOf(appLegend)).toBe(appLegend.length); // a vertical list: every entry on its own row
    const h = renderTimeline(p, theme, { interactive: false, holidays, horizontalLegend: true });
    expect(h.width).toBeLessThan(app.width - 100); // no side panel any more
    const hl = svgLegend(h.svg);
    expect(rowsOf(hl)).toBeLessThan(hl.length);
    const lastRowY = Math.max(...flat(parseXml(h.svg)).filter(n => n.tag === 'text' && /Go-live|Back-end/.test(n.text)).map(n => +n.attrs.y));
    expect(Math.min(...hl.map(x => x.y))).toBeGreaterThan(lastRowY); // below the last row of the chart
    const slide = slideTexts(exportPptx(p, theme, holidays));
    expect(rowsOf(slide)).toBeLessThan(slide.length);
  });

  it('where the app already shows the legend on a single line, the drawing is identical to the preview', () => {
    for (const tpl of TEMPLATES) for (const position of ['bottom', 'top'] as const) {
      const { p, theme, holidays } = project(tpl.id, 'month', 0, 0, position);
      const app = renderTimeline(p, theme, { interactive: false, holidays });
      if (rowsOf(svgLegend(app.svg)) !== 1) continue;
      const h = renderTimeline(p, theme, { interactive: false, holidays, horizontalLegend: true });
      expect(h.svg, `${tpl.id}/${position}`).toBe(app.svg);
    }
  });

  it('on one line the entries keep the app\'s spacing when there is room, and only tighten when there is not', () => {
    const { p, theme, holidays } = project('corporate', 'month', 0, 0);
    const app = svgLegend(renderTimeline(p, theme, { interactive: false, holidays }).svg);
    const roomy = svgLegend(renderTimeline(p, theme, { interactive: false, holidays, colScale: 2, horizontalLegend: true }).svg);
    expect(roomy.map(x => x.x - roomy[0].x)).toEqual(app.map(x => x.x - app[0].x)); // the same gaps, however wide the chart
    // with many entries the export widens the chart just enough that they all fit on the line, gaps never below the minimum
    const crowded = project('corporate', 'month', 0, 5);
    const slide = slideTexts(exportPptx(crowded.p, crowded.theme, holidays));
    expect(rowsOf(slide)).toBe(1);
    expect(slide.length).toBe(svgLegend(renderTimeline(crowded.p, crowded.theme, { interactive: false, holidays }).svg).length);
    const direct = renderTimeline(crowded.p, crowded.theme, { interactive: false, holidays, horizontalLegend: true });
    expect(direct.legendMinInner).toBeGreaterThan(direct.innerW); // too narrow for one line at the normal width…
    const widened = renderTimeline(crowded.p, crowded.theme, { interactive: false, holidays, horizontalLegend: true, colScale: (direct.legendMinInner - (direct.innerW - direct.axis.width)) / direct.axis.width });
    expect(rowsOf(svgLegend(widened.svg))).toBe(1); // …and exactly wide enough once widened
  });

  it('a legend placed above the chart stays above it', () => {
    const { p, theme, holidays } = project('corporate', 'month', 0, 0, 'top');
    const h = renderTimeline(p, theme, { interactive: false, holidays, horizontalLegend: true });
    const firstRowY = Math.min(...flat(parseXml(h.svg)).filter(n => n.tag === 'text' && /Discovery/.test(n.text)).map(n => +n.attrs.y));
    expect(Math.max(...svgLegend(h.svg).map(x => x.y))).toBeLessThan(firstRowY);
  });

  it('every template, at several scales: all the legend entries are there, in order, along the bottom of the chart and no wider than it', () => {
    for (const tpl of TEMPLATES) for (const [scale, extra] of [['month', 0], ['month', 14], ['week', 0], ['quarter', 20]] as const) {
      const { p, theme, holidays } = project(tpl.id, scale, extra, 3, 'right');
      const app = svgLegend(renderTimeline(p, theme, { interactive: false, holidays }).svg);
      const slide = slideTexts(exportPptx(p, theme, holidays));
      const tag = `${tpl.id}/${scale}/${extra}`;
      expect(slide.length, tag).toBe(app.length);
      expect(slide.map(s => s.text.replace(/…$/, '').slice(0, 8)), tag).toEqual(app.map(s => s.text.replace(/…$/, '').slice(0, 8))); // same entries, same order
      expect(rowsOf(slide), tag).toBe(1); // a single line, not a list or several rows
      for (const s of slide) { expect(s.x, tag).toBeGreaterThanOrEqual(0); expect(s.x, tag).toBeLessThanOrEqual(12192000); }
    }
  });

  it('dashed lines keep their exact pattern (e.g. the legend\'s Today line), not a preset', () => {
    const { p, theme, holidays } = project('corporate', 'month', 0, 0);
    const slide = readZip(exportPptx(p, theme, holidays))['ppt/slides/slide1.xml'];
    expect(slide).toContain('<a:custDash><a:ds d="150000" sp="100000"/></a:custDash>'); // 3 2 at width 2
    expect(slide).not.toContain('<a:prstDash');
  });
});
