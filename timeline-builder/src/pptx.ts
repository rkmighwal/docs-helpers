/**
 * Turns the timeline's SVG into an editable PowerPoint slide: every rectangle, text, line and marker becomes a
 * native PowerPoint shape (not a picture), so bars can be moved, recoloured and retyped in PowerPoint, Keynote or Google Slides.
 * Written without libraries: the package is a ZIP of XML parts, built by hand.
 */
import { XNode, parseXml } from './xml';
import type { Project, Theme } from './model';
import { Holiday, renderTimeline } from './render';
import { zipStore } from './zip';

const EMU_PT = 12700;
const SLIDE_W = 12192000; // 13.333 in: a standard 16:9 slide
const SLIDE_H = 6858000; // 7.5 in

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: string | undefined, d = 0): number => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : d; };
const hex6 = (c: string | undefined): string | null => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c.slice(1).toUpperCase() : null);

function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** A font that PowerPoint has: the first real family of the CSS list, preferring Arial for the usual sans-serif stacks. */
export function pickFont(css: string): string {
  const fams = css.split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const generic = /^(-apple-system|system-ui|ui-[a-z-]+|sans-serif|serif|monospace|cursive|fantasy|blinkmacsystemfont)$/i;
  if (fams.some(f => /^arial$/i.test(f))) return 'Arial';
  const real = fams.find(f => !generic.test(f));
  if (real) return real === 'Helvetica' ? 'Arial' : real;
  if (fams.some(f => /monospace/i.test(f))) return 'Consolas';
  if (fams.some(f => /^serif$/i.test(f))) return 'Georgia';
  return 'Arial';
}

interface Gradient { stops: { offset: number; color: string }[]; vertical: boolean }
interface Stripes { base: string; stripe: string }
interface Ctx { opacity: number }

/** The exact dash pattern of an SVG stroke (PowerPoint's own presets are much longer than e.g. `3 2`). Lengths are relative to the line width. */
function customDash(value: string | undefined, width: number): string {
  const n = (value ?? '').split(/[\s,]+/).map(parseFloat).filter(v => Number.isFinite(v) && v >= 0);
  if (!n.length || n.every(v => v === 0) || width <= 0) return '';
  const list = n.length % 2 ? [...n, ...n] : n;
  const pct = (v: number) => Math.max(1, Math.round((v / width) * 100000));
  const ds: string[] = [];
  for (let i = 0; i + 1 < list.length; i += 2) ds.push(`<a:ds d="${pct(list[i])}" sp="${pct(list[i + 1])}"/>`);
  return `<a:custDash>${ds.join('')}</a:custDash>`;
}

class Slide {
  private n = 2;
  private shapes: string[] = [];
  gradients = new Map<string, Gradient>();
  patterns = new Map<string, Stripes>();
  constructor(readonly k: number, readonly ox: number, readonly oy: number, readonly font: string) {}

  /** SVG px → EMU, as whole numbers. */
  x = (v: number): number => Math.round(this.ox + v * this.k);
  y = (v: number): number => Math.round(this.oy + v * this.k);
  d = (v: number): number => Math.max(0, Math.round(v * this.k));
  /** A font size in SVG px → hundredths of a point. */
  sz = (px: number): number => Math.min(400000, Math.max(100, Math.round((px * this.k * 100) / EMU_PT)));

  add(xml: string) { this.shapes.push(xml); }
  id(): number { return this.n++; }
  body(): string { return this.shapes.join(''); }
  count(): number { return this.shapes.length; }

  alpha(a: number): string { return a < 0.999 ? `<a:alpha val="${Math.max(0, Math.round(a * 100000))}"/>` : ''; }
  solid(color: string, a: number): string { return `<a:solidFill><a:srgbClr val="${color}">${this.alpha(a)}</a:srgbClr></a:solidFill>`; }

  /** The fill of a shape from an SVG `fill` value (a colour, `none` or a reference to a gradient / stripe pattern). */
  fill(value: string | undefined, a: number): string {
    if (value === undefined || value === 'none' || value === 'transparent') return '<a:noFill/>';
    const ref = /^url\(#([^)]+)\)$/.exec(value);
    if (ref) {
      const g = this.gradients.get(ref[1]);
      if (g) {
        const stops = g.stops.map(s => `<a:gs pos="${Math.round(s.offset * 100000)}"><a:srgbClr val="${s.color}">${this.alpha(a)}</a:srgbClr></a:gs>`).join('');
        return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${g.vertical ? 5400000 : 0}" scaled="0"/></a:gradFill>`;
      }
      const p = this.patterns.get(ref[1]);
      if (p) return `<a:pattFill prst="wdUpDiag"><a:fgClr><a:srgbClr val="${mixHex(p.base, p.stripe, 0.32)}">${this.alpha(a)}</a:srgbClr></a:fgClr><a:bgClr><a:srgbClr val="${p.base}">${this.alpha(a)}</a:srgbClr></a:bgClr></a:pattFill>`;
      return '<a:noFill/>';
    }
    const c = hex6(value);
    return c ? this.solid(c, a) : '<a:noFill/>';
  }

  /** The outline of a shape from SVG stroke attributes. */
  line(attrs: Record<string, string>, a: number): string {
    const c = hex6(attrs.stroke);
    if (!c) return '<a:ln><a:noFill/></a:ln>';
    const w = Math.max(3175, Math.round(num(attrs['stroke-width'], 1) * this.k));
    const dash = customDash(attrs['stroke-dasharray'], num(attrs['stroke-width'], 1));
    const cap = attrs['stroke-linecap'] === 'round' ? ' cap="rnd"' : '';
    const join = attrs['stroke-linejoin'] === 'round' ? '<a:round/>' : '<a:miter lim="800000"/>';
    return `<a:ln w="${w}"${cap}>${this.solid(c, a * num(attrs['stroke-opacity'], 1))}${dash}${join}</a:ln>`;
  }

  xfrm(x: number, y: number, w: number, h: number, extra = ''): string {
    return `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
  }
}

/* ---------------- shapes ---------------- */

function rectShape(s: Slide, n: XNode, ctx: Ctx, name: string) {
  const a = n.attrs;
  const w = num(a.width), h = num(a.height);
  if (w <= 0 || h <= 0) return;
  const rx = Math.min(num(a.rx, num(a.ry)), w / 2, h / 2);
  const geom = rx > 0.01 ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((rx / Math.min(w, h)) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const op = ctx.opacity;
  s.add(`<p:sp><p:nvSpPr><p:cNvPr id="${s.id()}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${s.xfrm(s.x(num(a.x)), s.y(num(a.y)), s.d(w), s.d(h))}${geom}${s.fill(a.fill ?? '#000000', op * num(a['fill-opacity'], 1))}${s.line(a, op)}</p:spPr></p:sp>`);
}

function circleShape(s: Slide, n: XNode, ctx: Ctx, name: string) {
  const a = n.attrs;
  const r = num(a.r);
  if (r <= 0) return;
  const cx = num(a.cx), cy = num(a.cy), op = ctx.opacity;
  s.add(`<p:sp><p:nvSpPr><p:cNvPr id="${s.id()}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${s.xfrm(s.x(cx - r), s.y(cy - r), s.d(2 * r), s.d(2 * r))}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${s.fill(a.fill ?? '#000000', op * num(a['fill-opacity'], 1))}${s.line(a, op)}</p:spPr></p:sp>`);
}

function lineShape(s: Slide, n: XNode, ctx: Ctx, name: string) {
  const a = n.attrs;
  const x1 = num(a.x1), y1 = num(a.y1), x2 = num(a.x2), y2 = num(a.y2);
  const flip = (x2 - x1) * (y2 - y1) < 0 ? ' flipV="1"' : '';
  s.add(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${s.id()}" name="${esc(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${s.xfrm(s.x(Math.min(x1, x2)), s.y(Math.min(y1, y2)), s.d(Math.abs(x2 - x1)), s.d(Math.abs(y2 - y1)), flip)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${s.line(a, ctx.opacity)}</p:spPr></p:cxnSp>`);
}

type Pt = [number, number];
type Seg = { pts: Pt[]; closed: boolean };

/** Sub-paths of an SVG path made of M, L, H, V and Z (the only commands the renderer writes), absolute or relative. */
export function parsePath(d: string): Seg[] {
  const segs: Seg[] = [];
  let cur: Seg | null = null, x = 0, y = 0, sx = 0, sy = 0;
  const toks = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const isCmd = (t: string) => /^[A-Za-z]$/.test(t);
  let i = 0, cmd = '';
  while (i < toks.length) {
    if (isCmd(toks[i])) {
      cmd = toks[i++];
      if (cmd.toUpperCase() === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; } continue; }
    } else if (!cmd || cmd.toUpperCase() === 'Z') { i++; continue; } // a number with no command to use it
    const rel = cmd === cmd.toLowerCase();
    const read = () => (i < toks.length && !isCmd(toks[i]) ? parseFloat(toks[i++]) : NaN);
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = read(), ny = read();
        if (Number.isNaN(nx) || Number.isNaN(ny)) break;
        x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y;
        cur = { pts: [[x, y]], closed: false }; segs.push(cur);
        cmd = rel ? 'l' : 'L'; // further pairs after a move are lines
        break;
      }
      case 'L': {
        const nx = read(), ny = read();
        if (Number.isNaN(nx) || Number.isNaN(ny)) break;
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        if (!cur) { cur = { pts: [[sx, sy]], closed: false }; segs.push(cur); }
        cur.pts.push([x, y]);
        break;
      }
      case 'H': { const nx = read(); if (Number.isNaN(nx)) break; x = rel ? x + nx : nx; cur?.pts.push([x, y]); break; }
      case 'V': { const ny = read(); if (Number.isNaN(ny)) break; y = rel ? y + ny : ny; cur?.pts.push([x, y]); break; }
      default: while (i < toks.length && !isCmd(toks[i])) i++; // a command this converter does not draw: skip its numbers
    }
  }
  return segs.filter(sg => sg.pts.length > 1);
}

function freeform(s: Slide, segs: Seg[], a: Record<string, string>, ctx: Ctx, name: string, defaultFill: string | undefined) {
  if (!segs.length) return;
  const all = segs.flatMap(sg => sg.pts);
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
  const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const w = Math.max(1, s.d(maxX - minX)), h = Math.max(1, s.d(maxY - minY));
  const pt = (p: Pt) => `<a:pt x="${Math.round((p[0] - minX) * s.k)}" y="${Math.round((p[1] - minY) * s.k)}"/>`;
  const path = segs.map(sg => `<a:moveTo>${pt(sg.pts[0])}</a:moveTo>${sg.pts.slice(1).map(p => `<a:lnTo>${pt(p)}</a:lnTo>`).join('')}${sg.closed ? '<a:close/>' : ''}`).join('');
  const op = ctx.opacity;
  const fill = a.fill ?? defaultFill;
  s.add(`<p:sp><p:nvSpPr><p:cNvPr id="${s.id()}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${s.xfrm(s.x(minX), s.y(minY), w, h)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${w}" h="${h}">${path}</a:path></a:pathLst></a:custGeom>${s.fill(fill, op * num(a['fill-opacity'], 1))}${s.line(a, op)}</p:spPr></p:sp>`);
}

function textShape(s: Slide, n: XNode, ctx: Ctx) {
  const a = n.attrs;
  const text = n.text.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const fs = num(a['font-size'], 16);
  const bold = /^(bold|[6-9]00)$/.test(a['font-weight'] ?? '');
  const anchor = a['text-anchor'] === 'middle' ? 'ctr' : a['text-anchor'] === 'end' ? 'r' : 'l';
  const tw = text.length * fs * (bold ? 0.64 : 0.58); // about how wide the text is; wrap is off, so the box only has to be roughly right
  const wPx = tw + fs;
  const hPx = fs * 1.25;
  const x = num(a.x), y = num(a.y);
  let rot = '';
  let top: number, left: number;
  let align = anchor;
  const rotate = /^rotate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)$/.exec(a.transform ?? '');
  if (rotate) {
    // rotated about (cx, cy): the visual centre of the glyphs moves with it, so the box is placed where that centre ends up
    const ang = parseFloat(rotate[1]), cx = parseFloat(rotate[2]), cy = parseFloat(rotate[3]);
    const rad = (ang * Math.PI) / 180;
    const gx = anchor === 'ctr' ? x : anchor === 'r' ? x - tw / 2 : x + tw / 2, gy = y - fs * 0.35; // centre of the glyphs before rotating
    const vx = gx - cx, vy = gy - cy;
    const centreX = cx + vx * Math.cos(rad) - vy * Math.sin(rad), centreY = cy + vx * Math.sin(rad) + vy * Math.cos(rad);
    left = centreX - wPx / 2; top = centreY - hPx / 2;
    rot = ` rot="${Math.round((((ang % 360) + 360) % 360) * 60000)}"`;
    align = 'ctr';
  } else {
    left = anchor === 'ctr' ? x - wPx / 2 : anchor === 'r' ? x - wPx : x;
    top = y - fs * 0.905; // the baseline sits about 0.9 of the font size below the top of a line
  }
  const c = hex6(a.fill) ?? '000000';
  const spc = a['letter-spacing'] ? ` spc="${Math.round((num(a['letter-spacing']) * s.k * 100) / EMU_PT)}"` : '';
  const op = ctx.opacity * num(a['fill-opacity'], 1);
  s.add(`<p:sp><p:nvSpPr><p:cNvPr id="${s.id()}" name="${esc('Text: ' + text.slice(0, 40))}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${s.xfrm(s.x(left), s.y(top), s.d(wPx), s.d(hPx), rot)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="${rotate ? 'ctr' : 't'}"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${s.sz(fs)}" b="${bold ? 1 : 0}" i="0"${spc} dirty="0">${s.solid(c, op)}<a:latin typeface="${esc(s.font)}"/><a:cs typeface="${esc(s.font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`);
}

function walk(s: Slide, n: XNode, ctx: Ctx) {
  switch (n.tag) {
    case 'g': { const c = { opacity: ctx.opacity * num(n.attrs.opacity, 1) }; for (const k of n.children) walk(s, k, c); return; }
    case 'rect': return rectShape(s, n, ctx, 'Rectangle');
    case 'circle': return circleShape(s, n, ctx, 'Circle');
    case 'line': return lineShape(s, n, ctx, 'Line');
    case 'text': return textShape(s, n, ctx);
    case 'polygon': case 'polyline': {
      const nums = (n.attrs.points ?? '').trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
      const pts: Pt[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      return freeform(s, [{ pts, closed: n.tag === 'polygon' }].filter(sg => sg.pts.length > 1), n.attrs, ctx, n.tag === 'polygon' ? 'Marker' : 'Mark', n.tag === 'polygon' ? '#000000' : 'none');
    }
    case 'path': {
      const segs = parsePath(n.attrs.d ?? '');
      // SVG paints an unstyled closed path black and an open one not at all (it has no area)
      return freeform(s, segs, n.attrs, ctx, 'Shape', segs.some(sg => sg.closed) ? '#000000' : 'none');
    }
    default: return; // defs, title, stop, pattern…: nothing to draw
  }
}

/* ---------------- package ---------------- */

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function themeXml(font: string): string {
  const clr = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const f = `<a:latin typeface="${esc(font)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const fillStyle = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Timeline Builder"><a:themeElements>` +
    `<a:clrScheme name="Timeline Builder">${clr('dk1', '000000')}${clr('lt1', 'FFFFFF')}${clr('dk2', '1F2937')}${clr('lt2', 'F3F4F6')}${clr('accent1', '3B82F6')}${clr('accent2', '10B981')}${clr('accent3', 'F59E0B')}${clr('accent4', 'EF4444')}${clr('accent5', '8B5CF6')}${clr('accent6', '06B6D4')}${clr('hlink', '2563EB')}${clr('folHlink', '7C3AED')}</a:clrScheme>` +
    `<a:fontScheme name="Timeline Builder"><a:majorFont>${f}</a:majorFont><a:minorFont>${f}</a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Timeline Builder"><a:fillStyleLst>${fillStyle}${fillStyle}${fillStyle}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fillStyle}${fillStyle}${fillStyle}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

const MASTER = `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>';

const LAYOUT = `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rels = (items: [string, string, string][]) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;

export interface PptxInfo { title?: string; author?: string }

/** Build a one-slide PowerPoint file (standard 16:9) from the timeline SVG, scaling the drawing to the slide. */
export function svgToPptx(svg: string, info: PptxInfo = {}, now = new Date()): Uint8Array {
  const root = parseXml(svg);
  if (root.tag !== 'svg') throw new Error('Expected an SVG drawing');
  const vb = (root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(parseFloat);
  const W = vb.length === 4 && vb[2] > 0 ? vb[2] : num(root.attrs.width, 1000);
  const H = vb.length === 4 && vb[3] > 0 ? vb[3] : num(root.attrs.height, 600);
  // The slide is always the standard 16:9; the drawing is scaled to fit it edge to edge (it has its own padding), centred on
  // the other axis. Use `exportPptx` to also lay the chart out for a 16:9 slide, so it fills the slide in both directions.
  const k = Math.min(SLIDE_W / W, SLIDE_H / H); // EMU per SVG px
  const font = pickFont(root.attrs['font-family'] ?? '');
  const s = new Slide(k, (SLIDE_W - W * k) / 2, (SLIDE_H - H * k) / 2, font);

  let bg = 'FFFFFF';
  let skippedBg = false;
  for (const n of root.children) {
    if (n.tag === 'defs') {
      for (const d of n.children) {
        if (d.tag === 'linearGradient' && d.attrs.id) {
          s.gradients.set(d.attrs.id, { vertical: num(d.attrs.y2) > num(d.attrs.x2), stops: d.children.filter(c => c.tag === 'stop').map(c => ({ offset: num(c.attrs.offset), color: hex6(c.attrs['stop-color']) ?? '000000' })) });
        } else if (d.tag === 'pattern' && d.attrs.id) {
          const rects = d.children.filter(c => c.tag === 'rect');
          s.patterns.set(d.attrs.id, { base: hex6(rects[0]?.attrs.fill) ?? '888888', stripe: hex6(rects[1]?.attrs.fill) ?? 'FFFFFF' });
        }
      }
      continue;
    }
    // the first full-size rectangle is the page background: it becomes the slide's background instead of a shape in the way
    if (!skippedBg && n.tag === 'rect' && num(n.attrs.width) >= W - 0.5 && num(n.attrs.height) >= H - 0.5) { bg = hex6(n.attrs.fill) ?? bg; skippedBg = true; continue; }
    walk(s, n, { opacity: 1 });
  }

  const slide = `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${EMPTY_TREE}${s.body()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const ct = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;
  const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
  return zipStore([
    { name: '[Content_Types].xml', data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      ct('/ppt/presentation.xml', `${PML}.presentation.main+xml`) + ct('/ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`) + ct('/ppt/slideLayouts/slideLayout1.xml', `${PML}.slideLayout+xml`) +
      ct('/ppt/slides/slide1.xml', `${PML}.slide+xml`) + ct('/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml') +
      ct('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml') + ct('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml') + '</Types>' },
    { name: '_rels/.rels', data: rels([['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', `${REL}/extended-properties`, 'docProps/app.xml']]) },
    { name: 'docProps/core.xml', data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(info.title ?? 'Timeline')}</dc:title><dc:creator>${esc(info.author ?? 'Timeline Builder')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Timeline Builder</Application><Slides>1</Slides></Properties>` },
    { name: 'ppt/presentation.xml', data: `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'], ['rId2', `${REL}/slide`, 'slides/slide1.xml'], ['rId3', `${REL}/theme`, 'theme/theme1.xml']]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'], ['rId2', `${REL}/theme`, '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slides/slide1.xml', data: slide },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: themeXml(font) },
  ], now);
}

/**
 * How far the time columns may be stretched to make a tall chart fit the slide. They are never squeezed: a chart that is
 * already wider than the slide is simply fitted to its width, which keeps headers and the legend exactly as in the app.
 */
const MIN_COL_SCALE = 1;
const MAX_COL_SCALE = 3;

/**
 * An editable PowerPoint slide of the timeline, on a standard 16:9 slide with the chart sized to it.
 *
 * A timeline is rarely 16:9. Scaling a tall chart evenly would leave empty bands at the sides, and stretching would
 * distort the text. So a tall chart is laid out again for the slide, with wider time columns, until it has the slide's
 * proportions; row heights and text sizes stay as they are. A chart that is already wide is fitted to the slide's width
 * (any spare room is left above and below). Either way the content runs edge to edge. The legend looks exactly as in the app
 * but sits on a single line (one placed at the side goes below the chart); the chart is widened a little if it is too narrow for that.
 */
export function exportPptx(p: Project, theme: Theme, holidays: Holiday[], info: PptxInfo = {}): Uint8Array {
  const target = SLIDE_W / SLIDE_H;
  let scale = 1;
  let r = renderTimeline(p, theme, { interactive: false, holidays, colScale: scale, horizontalLegend: true });
  // a single-line legend needs some width: if the chart is too narrow for it even with tight gaps, the columns are widened just enough
  const legendScale = r.legendMinInner > r.innerW ? Math.min(MAX_COL_SCALE, (r.legendMinInner - (r.innerW - r.axis.width)) / r.axis.width) : 1;
  if (legendScale > 1) r = renderTimeline(p, theme, { interactive: false, holidays, colScale: (scale = legendScale), horizontalLegend: true });
  const minScale = Math.max(MIN_COL_SCALE, legendScale);
  for (let i = 0; i < 4; i++) {
    const wantW = r.height * target;
    if (Math.abs(r.width - wantW) / wantW < 0.01) break;
    const gridW = r.axis.width, fixedW = r.width - gridW; // the label column and padding do not scale
    const next = Math.min(MAX_COL_SCALE, Math.max(minScale, (scale * (wantW - fixedW)) / gridW));
    if (Math.abs(next - scale) < 0.005) break;
    scale = next;
    r = renderTimeline(p, theme, { interactive: false, holidays, colScale: scale, horizontalLegend: true });
  }
  return svgToPptx(r.svg, { title: info.title ?? p.title, author: info.author });
}
