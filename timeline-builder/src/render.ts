import { BarStyle, GroupStyle, Item, ItemType, Look, Project, Scale, Theme } from './model';
import { lookOf } from './themes';
import { Axis, UNIT_NAME, axisStart, buildAxis } from './scale';
import { addDays, dow, periodIndexOf, shortDate, todayStr } from './dates';
import { ShapeId, shapeSvg } from './shapes';

export interface Holiday { date: string; name: string }
export interface RenderOpts { interactive: boolean; holidays: Holiday[] }
export interface Layout { svg: string; width: number; height: number; axis: Axis; chartX: number }

const PAD = 20;
const LABEL_W = 230;

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SUB_CELLS: Record<Scale, number> = { week: 7, month: 4, quarter: 3, year: 4 };
const lum = (hex: string): number => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const onColor = (hex: string): string => (lum(hex) > 0.62 ? '#1f2937' : '#ffffff');

const trunc = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s);
const textW = (s: string, size: number): number => s.length * size * 0.58;

function mix(hex: string, withHex: string, amt: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(withHex);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amt).toString(16).padStart(2, '0')).join('');
}

/** Collects gradient / pattern definitions referenced by bar styles. */
class Defs {
  private m = new Map<string, string>();
  gradient(color: string, to = ''): string {
    const id = 'g' + color.slice(1) + (to ? to.slice(1) : '');
    if (!this.m.has(id)) {
      this.m.set(id, to
        ? `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
        : `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(color, '#ffffff', 0.35)}"/><stop offset="1" stop-color="${color}"/></linearGradient>`);
    }
    return `url(#${id})`;
  }
  stripes(color: string): string {
    const id = 's' + color.slice(1);
    if (!this.m.has(id)) this.m.set(id, `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${color}"/><rect width="3.5" height="8" fill="#ffffff" fill-opacity="0.32"/></pattern>`);
    return `url(#${id})`;
  }
  toString(): string { return [...this.m.values()].join(''); }
}

function barSvg(d: Defs, x: number, y: number, w: number, h: number, r: number, color: string, style: BarStyle, progress: number, gradTo = ''): string {
  const rr = Math.min(r, h / 2, w / 2);
  const rect = (fill: string, extra = '', width = w) =>
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${h.toFixed(1)}" rx="${rr}" fill="${fill}" ${extra}/>`;
  const fillFor = (s: BarStyle) => (s === 'gradient' ? d.gradient(color, gradTo) : s === 'striped' ? d.stripes(color) : color);
  let base: string;
  switch (style) {
    case 'outline': base = rect(color, `fill-opacity="0.14" stroke="${color}" stroke-width="1.6"`); break;
    case 'shadow':
      base = `<rect x="${(x + 1.5).toFixed(1)}" y="${(y + 2.5).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rr}" fill="#000000" fill-opacity="0.2"/>` + rect(color);
      break;
    case 'gradient': base = rect(fillFor(style), gradTo ? `stroke="${color}" stroke-opacity="0.7" stroke-width="1"` : ''); break;
    default: base = rect(fillFor(style));
  }
  if (progress <= 0) return base;
  const done = rect(style === 'outline' ? color : fillFor(style === 'shadow' ? 'solid' : style), '', Math.max(0.5, (w * Math.min(100, progress)) / 100));
  return (style === 'outline' ? base : `<g opacity="0.4">${base}</g>`) + done;
}

function groupSvg(d: Defs, style: GroupStyle, x: number, cy: number, w: number, bh: number, color: string, r: number): string {
  void d;
  switch (style) {
    case 'heading': return '';
    case 'bar': {
      const hh = Math.max(5, bh * 0.55);
      return `<rect x="${x.toFixed(1)}" y="${(cy - hh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(r, hh / 2)}" fill="${color}"/>`;
    }
    case 'line':
      return `<line x1="${x.toFixed(1)}" y1="${cy}" x2="${(x + w).toFixed(1)}" y2="${cy}" stroke="${color}" stroke-width="3"/>` +
        `<path d="M${x.toFixed(1)} ${cy - 6}V${cy + 6}M${(x + w).toFixed(1)} ${cy - 6}V${cy + 6}" stroke="${color}" stroke-width="2.4"/>`;
    default: {
      const hh = bh * 0.42, top = cy - bh / 2 + 1;
      return `<path d="M${x.toFixed(1)} ${top}H${(x + w).toFixed(1)}V${top + hh + 6}L${(x + w - 6).toFixed(1)} ${top + hh}H${(x + 6).toFixed(1)}L${x.toFixed(1)} ${top + hh + 6}Z" fill="${color}"/>`;
    }
  }
}

function spans(items: Item[]): { s: string; e: string }[] {
  return items.map((it, i) => {
    if (it.type !== 'group') return { s: it.start, e: it.end };
    let s = '', e = '';
    for (let j = i + 1; j < items.length && items[j].level > it.level; j++) {
      if (items[j].type === 'holiday' || items[j].type === 'note') continue;
      if (!s || items[j].start < s) s = items[j].start;
      if (!e || items[j].end > e) e = items[j].end;
    }
    return s ? { s, e } : { s: it.start, e: it.end };
  });
}

type LegendKind = 'bar' | 'progress' | 'group' | 'marker' | 'band' | 'hline' | 'shade' | 'today' | 'swatch';
interface LegendEntry { kind: LegendKind; label: string; color: string; shape?: ShapeId; bar?: BarStyle; group?: GroupStyle }

const DEFAULT_LABEL: Record<ItemType, string> = {
  task: 'Task', group: 'Phase / group', milestone: 'Milestone', gate: 'Gate / check-point', holiday: 'Holiday / freeze period', note: 'Note',
};
const TYPE_ORDER: ItemType[] = ['task', 'group', 'milestone', 'gate', 'holiday', 'note'];

/** Effective look of an item, resolving the defaults of the project's theme and layout. */
export function itemLook(it: Item, t: Look): { color: string; shape: ShapeId; bar: BarStyle } {
  const c = t.colors;
  const sc = t.design.statusColors;
  const color = it.color || (it.type === 'task' && sc.length === 3 ? (it.progress >= 100 ? sc[0] : it.progress > 0 ? sc[1] : sc[2]) : it.type === 'task' && t.design.doneColor && it.progress >= 100 ? t.design.doneColor : it.type === 'holiday' ? c.holidayBand : c[it.type]);
  const shape = it.icon || (it.type === 'milestone' ? t.design.milestone : it.type === 'gate' ? t.design.gate : t.design.note);
  return { color, shape, bar: it.barStyle || t.design.bar };
}

function legendEntries(p: Project, t: Look, dated: boolean, hasHolidays: boolean, weekendShade: boolean): LegendEntry[] {
  const c = t.colors;
  const byKey = new Map<string, LegendEntry & { order: number; custom: boolean }>();
  for (const it of p.items) {
    if (it.type === 'group' && t.design.group === 'heading') continue;
    const look = itemLook(it, t);
    let key: string, e: LegendEntry;
    const sc = t.design.statusColors;
    const done = it.type === 'task' && !it.color && !!t.design.doneColor && sc.length !== 3 && it.progress >= 100;
    const statusLabel = it.type === 'task' && !it.color && sc.length === 3 ? (it.progress >= 100 ? 'Done' : it.progress > 0 ? 'In progress' : 'To do') : '';
    switch (it.type) {
      case 'task': key = `task|${look.color}|${look.bar}`; e = { kind: 'bar', label: '', color: look.color, bar: look.bar }; break;
      case 'group': key = `group|${look.color}`; e = { kind: 'group', label: '', color: look.color, group: t.design.group }; break;
      case 'holiday': key = `holiday|${look.color}`; e = { kind: 'band', label: '', color: look.color }; break;
      default: key = `${it.type}|${look.shape}|${look.color}`; e = { kind: 'marker', label: '', color: look.color, shape: look.shape };
    }
    const label = it.legendLabel?.trim() ?? '';
    const ex = byKey.get(key);
    if (!ex) byKey.set(key, { ...e, label: label || statusLabel || (done ? 'Done' : DEFAULT_LABEL[it.type]), order: TYPE_ORDER.indexOf(it.type), custom: !!label });
    else if (label && !ex.custom) { ex.label = label; ex.custom = true; }
  }
  const out: LegendEntry[] = [...byKey.values()].sort((a, b) => a.order - b.order);
  if (t.design.progress === 'overlay' && p.items.some(i => i.type === 'task' && i.progress > 0)) {
    const i = out.findIndex(e => e.kind === 'bar');
    out.splice(i < 0 ? 0 : i + 1, 0, { kind: 'progress', label: 'Completed portion', color: c.task, bar: t.design.bar });
  }
  if (dated && hasHolidays) out.push({ kind: 'hline', label: 'Public holiday', color: c.holiday });
  if (weekendShade) out.push({ kind: 'shade', label: 'Weekend', color: c.weekend });
  if (dated && p.showToday) out.push({ kind: 'today', label: 'Today', color: c.today });
  for (const cu of p.legend.custom) if (cu.label.trim()) out.push({ kind: 'swatch', label: cu.label, color: cu.color, shape: cu.icon });
  return out;
}

function legendSwatch(d: Defs, e: LegendEntry, x: number, cy: number, t: Look): string {
  const c = t.colors, r = Math.min(t.barRadius, 6);
  switch (e.kind) {
    case 'bar': return barSvg(d, x, cy - 6, 24, 12, r, e.color, e.bar || 'solid', 0, t.design.gradientTo);
    case 'progress': return barSvg(d, x, cy - 6, 24, 12, r, e.color, e.bar || 'solid', 55, t.design.gradientTo);
    case 'group': return groupSvg(d, e.group || 'bracket', x, cy, 24, 14, e.color, r);
    case 'marker': return shapeSvg(e.shape || 'diamond', x + 12, cy, 7, e.color, c.text, c.legendBg);
    case 'band': return `<rect x="${x}" y="${cy - 6}" width="24" height="12" fill="${e.color}" fill-opacity="0.6" stroke="${e.color}"/>`;
    case 'hline': return `<rect x="${x + 9}" y="${cy - 8}" width="5" height="16" fill="${e.color}" fill-opacity="0.45"/><line x1="${x + 11.5}" y1="${cy - 8}" x2="${x + 11.5}" y2="${cy + 8}" stroke="${e.color}" stroke-width="1.5"/>`;
    case 'shade': return `<rect x="${x}" y="${cy - 7}" width="24" height="14" fill="${e.color}" stroke="${c.border}" stroke-width="0.7"/>`;
    case 'today': return `<line x1="${x + 12}" y1="${cy - 8}" x2="${x + 12}" y2="${cy + 8}" stroke="${e.color}" stroke-width="2" stroke-dasharray="3 2"/>`;
    case 'swatch': return e.shape ? shapeSvg(e.shape, x + 12, cy, 7, e.color, c.text, c.legendBg) : `<rect x="${x}" y="${cy - 6}" width="24" height="12" rx="3" fill="${e.color}"/>`;
  }
}

const entryW = (e: LegendEntry): number => 24 + 8 + textW(e.label, 12) + 22;

export function renderTimeline(p: Project, theme: Theme, o: RenderOpts): Layout {
  const t = lookOf(p, theme);
  const c = t.colors, des = t.design;
  const dated = p.useDates;
  const defs = new Defs();
  const axis = buildAxis(p);
  const origin = axisStart(p);
  const num0 = Number.isFinite(p.firstIndex) ? p.firstIndex : 0;
  const rowH = t.rowHeight;
  const items = p.items;
  const sp = spans(items);
  const side = des.groupLabel === 'side';
  const rowsList = items.map((it, idx) => ({ it, idx })).filter(r => !(side && r.it.type === 'group'));
  const nRows = Math.max(rowsList.length, 3);
  const hdr1 = axis.groups.length ? 22 : 0;
  const hdr2 = axis.cols.some(col => col.sub) ? 40 : 28;
  const hdrH = hdr1 + hdr2;
  const chartX = PAD + LABEL_W;
  const holidays = dated && p.showHolidays ? o.holidays.filter(h => h.date >= axis.rangeStart && h.date < axis.rangeEnd) : [];
  const weekendShade = p.showWeekends && p.scale === 'week' && p.weekendDays.length > 0 && p.weekendDays.length < 7;
  const entries = p.legend.show ? legendEntries(p, t, dated, holidays.length > 0, weekendShade) : [];
  const bandRows = des.rows === 'bands' || des.rows === 'bands-full';
  const lineRows = des.rows === 'line' || des.rows === 'itemline';
  const pillCols = des.rows === 'pillcols';

  const spanText = (a: string, b: string): string => {
    if (dated) return a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`;
    const ia = periodIndexOf(a, origin, p.scale) + num0, ib = periodIndexOf(b, origin, p.scale) + num0;
    const u = UNIT_NAME[p.scale];
    return ia === ib ? `${u} ${ia}` : `${u}s ${ia}–${ib}`;
  };

  const innerW = LABEL_W + axis.width;
  const width = PAD * 2 + innerW;
  // ---- legend layout
  const boxesLegend = des.legend === 'boxes' && p.legend.position !== 'right' && entries.length > 0 && (innerW - 24) / entries.length >= 90;
  let legendH = 0, legendRightW = 0;
  const legendPlacement: { e: LegendEntry; x: number; y: number }[] = [];
  const legendTitleH = boxesLegend ? 0 : 22;
  if (entries.length) {
    if (boxesLegend) legendH = 36;
    else if (p.legend.position === 'right') {
      legendRightW = Math.max(160, Math.max(...entries.map(entryW)) + 20);
      entries.forEach((e, i) => legendPlacement.push({ e, x: 12, y: legendTitleH + 14 + i * 24 }));
      legendH = legendTitleH + 14 + entries.length * 24 + 6;
    } else {
      let x = 12, row = 0;
      for (const e of entries) {
        const w = entryW(e);
        if (x + w > innerW - 12 && x > 12) { x = 12; row++; }
        legendPlacement.push({ e, x, y: legendTitleH + 14 + row * 24 });
        x += w;
      }
      legendH = legendTitleH + 14 + (row + 1) * 24 + 4;
    }
  }

  // ---- vertical layout
  const totalW = width + (legendRightW ? legendRightW + PAD : 0);
  const hasTitle = !!(p.title || p.subtitle);
  const thin = des.frame === 'thin-bands', footerBand = des.frame === 'footer-band', rules = des.frame === 'rules' || des.frame === 'rule';
  const wrap = (str: string, max: number, maxLines: number): string[] => {
    const out: string[] = []; let cur = '';
    for (const w of str.split(/\s+/).filter(Boolean)) {
      if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) out.push(cur);
    return out.slice(0, maxLines);
  };
  const subX = totalW * 0.4;
  const titleLines = des.title === 'split' ? wrap(p.title, 20, 2) : [];
  const subLines = des.title === 'split' ? wrap(p.subtitle, Math.floor((totalW - PAD - subX) / 7.6), 4) : [];
  const topBandH = thin ? 14 : 0;
  const bottomBandH = thin ? 14 : footerBand ? 44 : 0;
  let y = topBandH;
  let bannerH = 0, titleY = 0, ruleTopY = 0;
  if (des.title === 'banner' && hasTitle) { bannerH = 86; y += bannerH + 24; }
  else if (des.title === 'split' && hasTitle) {
    y += PAD; titleY = y;
    y += Math.max(titleLines.length * 36, subLines.length * 20) + 18;
  }
  else if (des.title === 'center') { y += PAD; titleY = y; y += (p.title ? 42 : 0) + (p.subtitle ? 26 : 0) + 14; }
  else { y += PAD; titleY = y; y += (p.title ? 34 : 0) + (p.subtitle ? 22 : 0) + (hasTitle ? 12 : 0); }
  if (rules && hasTitle) { ruleTopY = y - 4; y += 14; }
  const legendTop = p.legend.position === 'top' && entries.length;
  const legendBottom = p.legend.position === 'bottom' && entries.length;
  const legendTopY = y; if (legendTop) y += legendH + 12;
  const hdrY = y; y += hdrH;
  const rowsY = y; const rowsH = nRows * rowH; y += rowsH;
  const legendBottomY = y + 12; if (legendBottom) y += legendH + 12;
  let footerTextY = 0;
  if (p.footerText && !footerBand) { footerTextY = y + 24; y += 34; }
  let ruleBottomY = 0;
  if (des.frame === 'rules') { ruleBottomY = y + 8; y += 18; }
  const bandY = y + (bottomBandH ? 0 : 0);
  y += bottomBandH || PAD;
  const rightLegendY = hdrY;
  const height = Math.max(y, legendRightW ? rightLegendY + legendH + PAD : 0);
  const chartRight = chartX + axis.width;
  const gridDash = t.gridStyle === 'dashed' ? 'stroke-dasharray="3 3"' : '';
  const ia = (attrs: string) => (o.interactive ? attrs : '');
  const hdrText = des.header === 'underline' || des.header === 'plain' ? (des.header === 'plain' ? c.headerText : c.text) : c.headerText;
  const palette = axis.groups.length ? des.headerPalette : [];

  const s: string[] = [];
  s.push(`<rect width="${totalW}" height="${height}" fill="${c.bg}"/>`);

  // ---- frame bands + title
  if (thin) s.push(`<rect x="0" y="0" width="${totalW}" height="${topBandH}" fill="${c.headerBg}"/>`);
  if (bottomBandH) s.push(`<rect x="0" y="${bandY}" width="${totalW}" height="${bottomBandH}" fill="${c.headerBg}"/>`);
  if (footerBand && p.footerText) s.push(`<text x="${totalW / 2}" y="${bandY + 28}" font-size="14" letter-spacing="1.5" text-anchor="middle" fill="${c.headerText}">${esc(p.footerText)}</text>`);
  else if (p.footerText) s.push(`<text x="${totalW / 2}" y="${footerTextY}" font-size="13" text-anchor="middle" fill="${c.text}">${esc(p.footerText)}</text>`);

  if (des.title === 'banner' && hasTitle) {
    s.push(`<rect x="0" y="${topBandH}" width="${totalW}" height="${bannerH}" fill="${c.headerBg}"/>`);
    const tc = des.titleColor || c.headerText, sc = des.subtitleColor || c.headerText;
    if (p.title) s.push(`<text x="${PAD + 12}" y="${topBandH + bannerH / 2 + 12}" font-size="34" font-weight="800" fill="${tc}">${esc(p.title)}</text>`);
    if (p.subtitle) {
      const avail = totalW - PAD * 2 - 24 - (p.title ? textW(p.title, 34) + 40 : 0);
      const size = textW(p.subtitle, 24) <= avail ? 24 : 14;
      const txt = trunc(p.subtitle, Math.max(8, Math.floor(avail / (size * 0.58))));
      s.push(`<text x="${totalW - PAD - 12}" y="${topBandH + bannerH / 2 + (size === 24 ? 10 : 5)}" font-size="${size}" text-anchor="end" fill="${sc}">${esc(txt)}</text>`);
    }
  } else if (des.title === 'split') {
    titleLines.forEach((ln, k) => s.push(`<text x="${PAD}" y="${titleY + 30 + k * 36}" font-size="30" font-weight="800" fill="${des.titleColor || c.text}">${esc(ln)}</text>`));
    subLines.forEach((ln, k) => s.push(`<text x="${subX}" y="${titleY + 20 + k * 20}" font-size="14" fill="${des.subtitleColor || c.subtext}">${esc(ln)}</text>`));
  } else if (des.title === 'center') {
    let ty = titleY;
    if (p.title) { ty += 32; s.push(`<text x="${totalW / 2}" y="${ty}" font-size="32" font-weight="800" text-anchor="middle" fill="${des.titleColor || c.text}">${esc(p.title)}</text>`); ty += 10; }
    if (p.subtitle) { ty += 18; s.push(`<text x="${totalW / 2}" y="${ty}" font-size="14" text-anchor="middle" fill="${des.subtitleColor || c.subtext}">${esc(p.subtitle)}</text>`); }
  } else {
    let ty = titleY;
    if (p.title) { ty += 26; s.push(`<text x="${PAD}" y="${ty}" font-size="${des.titleColor ? 30 : 24}" font-weight="700" fill="${des.titleColor || c.text}">${esc(p.title)}</text>`); ty += 8; }
    if (p.subtitle) { ty += 16; s.push(`<text x="${PAD}" y="${ty}" font-size="14" fill="${des.subtitleColor || c.subtext}">${esc(p.subtitle)}</text>`); }
  }
  if (rules) {
    const rc = des.title === 'split' ? c.border : c.text;
    if (hasTitle) s.push(`<line x1="${PAD}" y1="${ruleTopY + 8}" x2="${totalW - PAD}" y2="${ruleTopY + 8}" stroke="${rc}" stroke-width="1.5"/>`);
    if (des.frame === 'rules') s.push(`<line x1="${PAD}" y1="${ruleBottomY}" x2="${totalW - PAD}" y2="${ruleBottomY}" stroke="${c.text}" stroke-width="1.2"/>`);
  }

  const drawLegend = (bx: number, by: number, bw: number, bh: number) => {
    if (boxesLegend) {
      const gap = 8, w = (bw - gap * (entries.length - 1)) / entries.length;
      entries.forEach((e, i) => {
        const x = bx + i * (w + gap);
        s.push(`<rect x="${x.toFixed(1)}" y="${by}" width="${w.toFixed(1)}" height="${bh - 4}" fill="${e.color}" stroke="${c.border}" ${gridDash}/>`);
        s.push(`<text x="${(x + w / 2).toFixed(1)}" y="${by + (bh - 4) / 2 + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="${onColor(e.color)}">${esc(trunc(e.label, Math.floor(w / 7)))}</text>`);
      });
      return;
    }
    s.push(`<g><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${c.legendBg}" stroke="${c.border}"/>`);
    s.push(`<text x="${bx + 12}" y="${by + 16}" font-size="11" font-weight="700" letter-spacing="1" fill="${c.subtext}">LEGEND</text>`);
    for (const { e, x, y: ly } of legendPlacement) {
      s.push(legendSwatch(defs, e, bx + x, by + ly, t));
      s.push(`<text x="${bx + x + 32}" y="${by + ly + 4}" font-size="12" fill="${c.text}">${esc(e.label)}</text>`);
    }
    s.push('</g>');
  };
  if (legendTop) drawLegend(PAD, legendTopY, innerW, legendH);

  // ---- current-period highlight column
  let hiCol = -1;
  if (des.highlight) {
    if (dated) hiCol = axis.cols.findIndex(col => todayStr() >= col.start && todayStr() < col.next);
    else if (p.currentPeriod !== undefined && p.currentPeriod !== null) hiCol = p.currentPeriod - num0;
    if (hiCol < 0 || hiCol >= axis.cols.length) hiCol = -1;
  }

  // ---- header
  const plainHdr = des.header === 'plain';
  const hdrFill = des.header === 'underline' || plainHdr ? 'none' : c.headerBg;
  s.push(`<rect x="${PAD}" y="${hdrY}" width="${LABEL_W}" height="${hdrH}" fill="${hdrFill}"/>`);
  if (des.labelHeading) s.push(`<text x="${PAD + (plainHdr ? 14 : 10)}" y="${hdrY + hdrH / 2 + 4}" font-size="${plainHdr ? 14 : 12}" font-weight="700" fill="${hdrText}">${esc(des.labelHeading)}</text>`);
  if (hdr1) {
    if (palette.length) axis.groups.forEach((g, gi) => s.push(`<rect x="${chartX + g.x}" y="${hdrY}" width="${g.w}" height="${hdr1}" fill="${palette[gi % palette.length]}"/>`));
    else s.push(`<rect x="${chartX}" y="${hdrY}" width="${axis.width}" height="${hdr1}" fill="${hdrFill}"/>`);
  }
  axis.groups.forEach((g, gi) => {
    const tc = palette.length ? onColor(palette[gi % palette.length]) : hdrText;
    s.push(`<text x="${chartX + g.x + g.w / 2}" y="${hdrY + 15}" font-size="12" font-weight="700" text-anchor="middle" fill="${tc}">${esc(g.label)}</text>`);
    if (g.x > 0 && !palette.length) s.push(`<line x1="${chartX + g.x}" y1="${hdrY + 3}" x2="${chartX + g.x}" y2="${hdrY + hdr1}" stroke="${hdrText}" stroke-opacity="0.35"/>`);
  });
  axis.cols.forEach((col, ci) => {
    const cx = chartX + col.x;
    const gi = palette.length ? axis.groups.findIndex(g => col.x >= g.x - 0.5 && col.x < g.x + g.w - 0.5) : -1;
    const hi = ci === hiCol;
    const fill = hi ? des.highlight : gi >= 0 ? palette[gi % palette.length] : c.headerBg2;
    if (hi || des.header === 'solid' || des.header === 'rounded') {
      if (des.header === 'rounded') s.push(`<rect x="${cx + 2}" y="${hdrY + hdr1 + 2}" width="${col.w - 4}" height="${hdr2 - 4}" rx="${Math.min(10, (hdr2 - 4) / 2)}" fill="${fill}"/>`);
      else s.push(`<rect x="${cx}" y="${hdrY + hdr1}" width="${col.w}" height="${hdr2}" fill="${fill}" stroke="${palette.length ? 'none' : c.headerBg}" stroke-width="0.8"/>`);
    } else if (des.header === 'underline') s.push(`<line x1="${cx}" y1="${hdrY + hdr1 + hdr2}" x2="${cx + col.w}" y2="${hdrY + hdr1 + hdr2}" stroke="${c.headerBg2}" stroke-width="2"/>`);
    const ct = hi ? c.text : des.header === 'underline' ? c.text : plainHdr ? c.headerText : onColor(fill) === '#ffffff' || des.header === 'solid' && !palette.length ? c.headerText : onColor(fill);
    const colText = palette.length ? onColor(fill) : ct;
    const mid = hdrY + hdr1 + (col.sub ? 16 : hdr2 / 2 + 4);
    s.push(`<text x="${cx + col.w / 2}" y="${mid}" font-size="${plainHdr ? 13 : 12}" font-weight="${plainHdr ? 700 : 600}" text-anchor="middle" fill="${colText}">${esc(col.label)}</text>`);
    if (col.sub) s.push(`<text x="${cx + col.w / 2}" y="${mid + 15}" font-size="10" text-anchor="middle" fill="${colText}" fill-opacity="0.8">${esc(col.sub)}</text>`);
  });
  if (des.header === 'underline') s.push(`<line x1="${PAD}" y1="${hdrY + hdrH}" x2="${PAD + innerW}" y2="${hdrY + hdrH}" stroke="${c.headerBg}" stroke-width="2"/>`);

  // ---- row backgrounds
  if (pillCols) {
    s.push(`<rect x="${PAD - 6}" y="${rowsY - 4}" width="${innerW + 12}" height="${rowsH + 12}" rx="22" fill="${c.rowAlt}"/>`);
    for (const col of axis.cols) s.push(`<rect x="${chartX + col.x + 4}" y="${rowsY + 4}" width="${col.w - 8}" height="${rowsH - 4}" rx="${Math.min(16, col.w / 2 - 4)}" fill="${c.weekend}"/>`);
  }
  for (let i = 0; i < nRows; i++) {
    const ry = rowsY + i * rowH;
    if (pillCols) continue;
    if (bandRows) {
      if (t.zebra && i % 2 === 1) continue;
      const bx = des.rows === 'bands-full' ? PAD : chartX, bw = des.rows === 'bands-full' ? innerW : axis.width;
      s.push(`<rect x="${bx}" y="${ry + 1.5}" width="${bw}" height="${rowH - 3}" rx="${Math.min(t.barRadius, (rowH - 3) / 2)}" fill="${c.rowAlt}"/>`);
    } else if (!lineRows && t.zebra && i % 2 === 1) s.push(`<rect x="${PAD}" y="${ry}" width="${innerW}" height="${rowH}" fill="${c.rowAlt}"/>`);
  }
  if (hiCol >= 0) s.push(`<rect x="${chartX + axis.cols[hiCol].x}" y="${rowsY}" width="${axis.cols[hiCol].w}" height="${rowsH}" fill="${des.highlight}" fill-opacity="0.16"/>`);

  if (weekendShade) {
    for (let d = axis.rangeStart; d < axis.rangeEnd; d = addDays(d, 1)) {
      if (p.weekendDays.includes(dow(d))) {
        const x1 = chartX + axis.xOf(d), x2 = chartX + axis.xOf(addDays(d, 1));
        s.push(`<rect x="${x1.toFixed(1)}" y="${rowsY}" width="${(x2 - x1).toFixed(1)}" height="${rowsH}" fill="${c.weekend}" fill-opacity="0.8"/>`);
      }
    }
  }
  for (const it of items) {
    if (it.type !== 'holiday') continue;
    const x1 = chartX + axis.xOf(it.start), x2 = chartX + axis.xOf(addDays(it.end, 1));
    if (x2 > x1) s.push(`<rect x="${x1.toFixed(1)}" y="${rowsY}" width="${(x2 - x1).toFixed(1)}" height="${rowsH}" fill="${it.color || c.holidayBand}" fill-opacity="0.2"/>`);
  }

  // ---- grid
  const cellW = axis.colW / SUB_CELLS[p.scale];
  if (t.gridStyle !== 'none') {
    for (const col of axis.cols) {
      if (des.cells) for (let k = 1; k < SUB_CELLS[p.scale]; k++) s.push(`<line x1="${chartX + col.x + k * cellW}" y1="${rowsY}" x2="${chartX + col.x + k * cellW}" y2="${rowsY + rowsH}" stroke="${c.grid}" stroke-opacity="0.55" stroke-dasharray="3 3"/>`);
      if (col.x === 0) continue;
      s.push(`<line x1="${chartX + col.x}" y1="${rowsY}" x2="${chartX + col.x}" y2="${rowsY + rowsH}" stroke="${c.grid}" ${gridDash}/>`);
    }
    if (!bandRows && !pillCols) for (let i = 0; i <= nRows; i++) {
      s.push(`<line x1="${PAD}" y1="${rowsY + i * rowH}" x2="${lineRows ? chartX : chartRight}" y2="${rowsY + i * rowH}" stroke="${c.grid}" stroke-opacity="0.8" ${des.cells ? gridDash : ''}/>`);
    }
  }
  if (!bandRows && !pillCols) {
    for (const g of axis.groups) if (g.x > 0 && !palette.length) s.push(`<line x1="${chartX + g.x}" y1="${rowsY}" x2="${chartX + g.x}" y2="${rowsY + rowsH}" stroke="${c.border}"/>`);
    s.push(`<rect x="${PAD}" y="${rowsY}" width="${innerW}" height="${rowsH}" fill="none" stroke="${c.border}" ${des.cells ? gridDash : ''}/>`);
    s.push(`<line x1="${chartX}" y1="${rowsY}" x2="${chartX}" y2="${rowsY + rowsH}" stroke="${c.border}"/>`);
    if (!plainHdr && !des.cells) s.push(`<rect x="${PAD}" y="${hdrY}" width="${innerW}" height="${hdrH}" fill="none" stroke="${c.border}"/>`);
  }

  for (const h of holidays) {
    const x1 = chartX + axis.xOf(h.date), x2 = chartX + axis.xOf(addDays(h.date, 1));
    const w = Math.max(1.6, x2 - x1);
    s.push(`<g><title>${esc(h.name)} (${esc(h.date)})</title><rect x="${x1.toFixed(1)}" y="${rowsY}" width="${w.toFixed(1)}" height="${rowsH}" fill="${c.holiday}" fill-opacity="0.28"/>` +
      `<line x1="${(x1 + w / 2).toFixed(1)}" y1="${rowsY}" x2="${(x1 + w / 2).toFixed(1)}" y2="${rowsY + rowsH}" stroke="${c.holiday}" stroke-width="1" stroke-opacity="0.8"/></g>`);
  }

  const today = todayStr();
  if (dated && p.showToday && today >= axis.rangeStart && today < axis.rangeEnd) {
    const tx = chartX + axis.xOf(today) + (axis.xOf(addDays(today, 1)) - axis.xOf(today)) / 2;
    if (pillCols) {
      s.push(`<line x1="${tx.toFixed(1)}" y1="${rowsY - 2}" x2="${tx.toFixed(1)}" y2="${rowsY + rowsH + 6}" stroke="${c.today}" stroke-width="2"/>`);
      s.push(`<circle cx="${tx.toFixed(1)}" cy="${rowsY - 4}" r="4" fill="${c.bg}" stroke="${c.today}" stroke-width="2"/>`);
    } else {
      s.push(`<line x1="${tx.toFixed(1)}" y1="${hdrY + hdrH}" x2="${tx.toFixed(1)}" y2="${rowsY + rowsH}" stroke="${c.today}" stroke-width="2" stroke-dasharray="4 3"/>`);
      s.push(`<path d="M${tx - 5} ${rowsY}L${tx + 5} ${rowsY}L${tx} ${rowsY + 7}Z" fill="${c.today}"/>`);
    }
  }

  // ---- rows
  const fs = 12;
  const sideOffset = side ? 34 : 0;
  rowsList.forEach(({ it, idx }, i) => {
    const ry = rowsY + i * rowH, cy = ry + rowH / 2;
    const bh = des.cells ? rowH : Math.max(6, (rowH * t.barHeight) / 100);
    const look = itemLook(it, t);
    const color = look.color;
    const isPoint = it.type === 'milestone' || it.type === 'gate' || it.type === 'note';

    if (des.rows === 'itemline') s.push(`<line x1="${chartX}" y1="${cy}" x2="${chartRight}" y2="${cy}" stroke="${color}" stroke-opacity="0.8" stroke-width="1.2"/>`);
    else if (des.rows === 'line') s.push(`<line x1="${chartX}" y1="${cy}" x2="${chartRight}" y2="${cy}" stroke="${c.grid}" stroke-width="1.2"/>`);

    let tx0 = PAD + 10 + it.level * 14 + sideOffset;
    const showIcon = isPoint || !!it.icon;
    if (showIcon) { s.push(shapeSvg(look.shape, tx0 + 5, cy, 4.5, color, c.text, c.bg)); tx0 += 16; }
    const maxCh = Math.floor((LABEL_W - 16 - it.level * 14 - sideOffset - (showIcon ? 16 : 0)) / (fs * 0.58));
    const heading = it.type === 'group' && des.group === 'heading';
    if (heading && i > 0) s.push(`<line x1="${PAD + 10}" y1="${ry}" x2="${chartRight - 10}" y2="${ry}" stroke="${c.border}" stroke-width="1.2"/>`);
    s.push(`<text x="${tx0}" y="${cy + 4}" font-size="${heading ? 12 : fs}" ${it.type === 'group' ? 'font-weight="700"' : ''} fill="${heading ? c.group : c.text}">${esc(trunc(it.name, maxCh))}</text>`);

    const { s: a, e: b } = sp[idx];
    if (b < axis.rangeStart || a >= axis.rangeEnd) return;
    const x1 = chartX + axis.xOf(a);
    const x2 = chartX + axis.xOf(addDays(b, 1));
    const dateTxt = spanText(a, b);
    const idAttr = ia(`data-id="${it.id}"`);
    const tip = `<title>${esc(it.name)} · ${esc(dateTxt)}${it.workingDays ? ` · ${it.workingDays} working days` : ''}</title>`;
    const handles = (x: number, w: number) => o.interactive
      ? `<rect x="${x.toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="6" height="${bh}" fill="transparent" data-role="resize-l"/><rect x="${(x + w - 6).toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="6" height="${bh}" fill="transparent" data-role="resize-r"/>` : '';

    const labelRight = (x: number, text: string, subdued = false) => {
      const w = textW(text, fs);
      const left = x + 8 + w > chartRight - 4 && x - 8 - w > chartX;
      s.push(`<text x="${left ? x - 8 : x + 8}" y="${cy + 4}" font-size="${fs}" ${left ? 'text-anchor="end"' : ''} fill="${subdued ? c.subtext : c.text}">${esc(text)}</text>`);
    };

    if (it.type === 'task' || (des.cells && it.type === 'group')) {
      let bx = x1, w = Math.max(3, x2 - x1);
      if (des.cells) {
        const sx = Math.floor((x1 - chartX) / cellW + 1e-6) * cellW, ex = Math.ceil((x2 - chartX) / cellW - 1e-6) * cellW;
        bx = chartX + sx; w = Math.max(cellW, ex - sx);
      }
      const shape = des.cells
        ? `<rect x="${bx.toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${bh}" fill="${color}" stroke="${c.border}" stroke-width="0.6"/>`
        : barSvg(defs, bx, cy - bh / 2, w, bh, t.barRadius, color, look.bar, it.type === 'task' && des.progress === 'overlay' ? it.progress : 0, des.gradientTo);
      let inner = '';
      if (it.type === 'task' && (des.progress === 'percent' || des.progress === 'status')) {
        const txt = des.progress === 'percent' ? (it.progress > 0 ? `${it.progress}%` : '') : it.progress >= 100 ? 'Done' : it.progress > 0 ? 'On Progress' : '';
        if (txt && textW(txt, 11) + 20 < w) {
          const rightAlign = des.progress === 'percent' || it.progress < 100;
          inner = `<text x="${rightAlign ? bx + w - 12 : bx + 12}" y="${cy + 4}" font-size="11" ${rightAlign ? 'text-anchor="end"' : ''} fill="${onColor(color)}" pointer-events="none">${esc(txt)}</text>`;
        }
      }
      s.push(`<g ${idAttr}>${tip}<g ${ia('data-role="move"')}>${shape}</g>${inner}${handles(bx, w)}</g>`);
      if (p.showDates) labelRight(bx + w, dateTxt, true);
    } else if (it.type === 'group') {
      const w = Math.max(6, x2 - x1);
      s.push(`<g>${tip}${groupSvg(defs, des.group, x1, cy, w, bh, color, t.barRadius)}</g>`);
      if (p.showDates) labelRight(x1 + w, dateTxt, true);
    } else if (it.type === 'holiday') {
      const w = Math.max(3, x2 - x1);
      s.push(`<g ${idAttr}>${tip}<rect x="${x1.toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${bh}" rx="${t.barRadius}" fill="${color}" fill-opacity="0.6" stroke="${color}" ${ia('data-role="move"')}/>${handles(x1, w)}</g>`);
      labelRight(x1 + w, it.name + (p.showDates ? ` · ${dateTxt}` : ''), true);
    } else {
      const mx = x1 + (x2 - x1) / 2;
      const r = it.type === 'note' ? 4.5 : Math.min(rowH / 2 - 3, 9);
      s.push(`<g ${idAttr}>${tip}<g ${ia('data-role="move"')}>${shapeSvg(look.shape, +mx.toFixed(1), cy, r, color, c.text, c.bg)}</g></g>`);
      labelRight(mx + r, it.name + (p.showDates ? ` · ${dateTxt}` : ''), it.type === 'note');
    }
  });

  // ---- vertical group pills beside their rows
  if (side) {
    items.forEach((g, gi) => {
      if (g.type !== 'group') return;
      let end = gi + 1;
      while (end < items.length && items[end].level > g.level) end++;
      const idxs = rowsList.map((r, ri) => ({ r, ri })).filter(x => x.r.idx > gi && x.r.idx < end).map(x => x.ri);
      if (!idxs.length) return;
      const kids = items.slice(gi + 1, end).filter(k => k.type === 'task');
      const allDone = !!des.doneColor && kids.length > 0 && kids.every(k => k.progress >= 100);
      const col = g.color || (allDone ? des.doneColor : c.group);
      const top = rowsY + idxs[0] * rowH + 6, h = (idxs[idxs.length - 1] - idxs[0] + 1) * rowH - 12;
      const cx = PAD + 18, cyy = top + h / 2;
      s.push(`<rect x="${PAD + 6}" y="${top}" width="24" height="${h}" rx="12" fill="${col}"><title>${esc(g.name)}</title></rect>`);
      const label = trunc(g.name, Math.max(3, Math.floor((h - 12) / 7)));
      s.push(`<text transform="rotate(-90 ${cx} ${cyy})" x="${cx}" y="${cyy + 4}" font-size="12" font-weight="700" text-anchor="middle" fill="${onColor(col)}">${esc(label)}</text>`);
    });
  }

  if (legendBottom) drawLegend(PAD, legendBottomY, innerW, legendH);
  if (legendRightW) drawLegend(PAD + innerW + PAD, rightLegendY, legendRightW, legendH);

  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" viewBox="0 0 ${totalW} ${height}" font-family="${esc(t.fontFamily)}"><defs>${defs}</defs>`;
  return { svg: head + s.join('') + '</svg>', width: totalW, height, axis, chartX };
}
