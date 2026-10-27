import { Project, Theme } from './model';
import { TableModel, buildTable, fmtNum, isLeafKind, labelCell } from './table';
import { alertOn, contrastText, legible, mix } from './color';
import { fmtMoney } from './cost';
import { DOW } from './dates';

export interface RenderOpts {
  /** Adds data attributes and hover tooltips for the on-screen preview; exports leave them out. */
  interactive: boolean;
  /** false leaves the cost rows out (used by exports that exclude cost). Default: include them when they are switched on. */
  cost?: boolean;
}
export interface RenderResult { svg: string; width: number; height: number }

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number): string => String(Math.round(n * 100) / 100);

/** Rough text width: good enough to size columns without a DOM. */
export const textWidth = (s: string, fs: number, bold = false): number => s.length * fs * (bold ? 0.6 : 0.55);

function fit(s: string, maxW: number, fs: number, bold = false): string {
  if (textWidth(s, fs, bold) <= maxW) return s;
  const n = Math.max(1, Math.floor(maxW / (fs * (bold ? 0.6 : 0.55))) - 1);
  return s.slice(0, n) + '…';
}

export const ROW_FACTOR = { compact: 1.9, normal: 2.4, roomy: 3 } as const;

/** Summary of the working calendar, e.g. "Mon–Fri" or "Mon, Tue, Thu". */
export function workDaysLabel(days: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d));
  if (order.length === 7) return 'every day';
  if (!order.length) return 'none';
  const runs: number[][] = [];
  for (const d of order) {
    const last = runs[runs.length - 1];
    if (last && (last[last.length - 1] + 1) % 7 === d) last.push(d); else runs.push([d]);
  }
  return runs.map(r => (r.length >= 3 ? `${DOW[r[0]]}–${DOW[r[r.length - 1]]}` : r.map(d => DOW[d]).join(', '))).join(', ');
}

export function renderPlan(p: Project, theme: Theme, holidays: Iterable<string>, opts: RenderOpts): RenderResult {
  return renderTable(buildTable(p, holidays, { cost: opts.cost }), p, theme, opts);
}

export function renderTable(t: TableModel, p: Project, theme: Theme, opts: RenderOpts): RenderResult {
  const c = theme.colors, st = p.style, v = p.view, fs = theme.fontSize, bw = st.borderWidth;
  const rowH = Math.round(fs * ROW_FACTOR[st.density]);
  const PAD = 16;
  const off = bw <= 1 ? 0.5 : 0;
  const dash = st.borderStyle === 'dashed' ? `${f(bw * 4)} ${f(bw * 3)}` : st.borderStyle === 'dotted' ? `${f(bw)} ${f(bw * 2.5)}` : '';
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  const font = `font-family="${esc(theme.fontFamily)}"`;
  const colW = t.axis.colW;
  const nCols = t.axis.cols.length;
  const hasSub = t.axis.cols.some(x => x.sub);
  const showWD = v.showWorkingDays && p.useDates;

  /* ---- column geometry ---- */
  const labelText = labelCell;
  const labelW = t.labelCols.map(col => {
    let w = textWidth(col.title, fs, true);
    for (const r of t.rows) {
      if (r.kind === 'section') continue;
      const extra = col.id === 'name' ? r.level * 14 + (r.color ? 8 : 0) : 0;
      w = Math.max(w, textWidth(labelText(col, r), fs, r.kind === 'group' || r.kind === 'total') + extra);
    }
    const [lo, hi] = col.id === 'name' ? [130, 320] : col.id === 'start' || col.id === 'end' ? [78, 110] : col.id === 'qty' ? [46, 70] : [80, 200];
    return Math.min(hi, Math.max(lo, Math.ceil(w + 22)));
  });
  // amounts of money carry their currency: $343,000, €1.25M, 12,000 kr
  const fmtOf = (r: { money?: boolean }) => (r.money ? (x: number) => fmtMoney(x, t.cost?.currency ?? '') : fmtNum);
  const totalW = v.colTotal ? Math.max(52, Math.ceil(textWidth(t.totalTitle, fs, true) + 22), ...t.rows.map(r => (r.total === null || r.kind === 'section' ? 0 : Math.ceil(textWidth(fmtOf(r)(r.total), fs, true) + 18)))) : 0;
  const x0 = PAD;
  const labelsX: number[] = [];
  { let x = x0; for (const w of labelW) { labelsX.push(x); x += w; } }
  const gridX = x0 + labelW.reduce((a, b) => a + b, 0);
  const totalX = gridX + nCols * colW;
  const tableW = totalX + totalW - x0;

  /* ---- vertical geometry ---- */
  const subH = hasSub ? Math.round(rowH * 1.5) : rowH;
  const groupH = t.axis.groups.length ? rowH : 0;
  const wdH = showWD ? Math.round(rowH * 0.8) : 0;
  const headH = groupH + subH + wdH;

  const titleOn = v.showTitle && (p.title || p.subtitle);
  const bannerH = Math.round(fs * 3.6);
  const titleH = !titleOn ? 0 : st.title === 'banner' ? bannerH + 12 : Math.round(fs * 2.2) + (p.subtitle ? Math.round(fs * 1.5) : 0) + 10;
  const tableY = PAD + titleH;
  const bodyY = tableY + headH;
  const bodyH = t.rows.length * rowH;
  const tableH = headH + bodyH;

  const hdrFill = st.header === 'solid' ? c.headerBg : c.bg;
  const hdrText = st.header === 'solid' ? c.headerText : legible(c.headerText, c.bg, c.text);
  const out: string[] = [];
  const fills: string[] = [], texts: string[] = [], lines: string[] = [], over: string[] = [], hits: string[] = [];
  const text = (x: number, y: number, s: string, o: { size?: number; bold?: boolean; fill?: string; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; opacity?: number } = {}) => {
    if (!s) return;
    const size = o.size ?? fs;
    texts.push(`<text x="${f(x)}" y="${f(y + size * 0.35)}" font-size="${size}"${o.bold ? ' font-weight="700"' : ''}${o.italic ? ' font-style="italic"' : ''} fill="${o.fill ?? c.text}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.opacity ? ` opacity="${o.opacity}"` : ''}>${esc(s)}</text>`);
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') => fills.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${extra}/>`);
  const hline = (y: number, xa: number, xb: number, width = bw) => lines.push(`<path d="M${f(xa)} ${f(Math.round(y) + off)}H${f(xb)}" stroke-width="${f(width)}"/>`);
  const vline = (x: number, ya: number, yb: number, width = bw) => lines.push(`<path d="M${f(Math.round(x) + off)} ${f(ya)}V${f(yb)}" stroke-width="${f(width)}"/>`);

  const cy = (y: number, h: number) => y + h / 2;
  const alignX = (x: number, w: number): [number, 'start' | 'middle' | 'end'] =>
    st.align === 'left' ? [x + 8, 'start'] : st.align === 'right' ? [x + w - 8, 'end'] : [x + w / 2, 'middle'];

  /* ---- header ---- */
  if (st.header === 'solid') rect(x0, tableY, tableW, headH, hdrFill);
  const headLabelY = cy(tableY, headH);
  t.labelCols.forEach((col, i) => {
    const tx = col.align === 'left' ? labelsX[i] + 10 : labelsX[i] + labelW[i] / 2;
    text(tx, headLabelY, fit(col.title, labelW[i] - 16, fs, true), { bold: true, fill: hdrText, anchor: col.align === 'left' ? 'start' : 'middle' });
  });
  if (groupH) {
    for (const g of t.axis.groups) {
      const gx = gridX + g.x;
      if (st.header === 'solid') rect(gx, tableY, g.w, groupH, mix(c.headerBg, '#000000', 0.16));
      text(gx + g.w / 2, cy(tableY, groupH), fit(g.label, g.w - 8, fs, true), { bold: true, fill: hdrText, anchor: 'middle' });
    }
  }
  t.axis.cols.forEach((col, i) => {
    const px = gridX + i * colW, py = tableY + groupH;
    if (col.sub) {
      text(px + colW / 2, py + subH * 0.36, col.label, { bold: true, fill: hdrText, anchor: 'middle' });
      text(px + colW / 2, py + subH * 0.74, col.sub, { size: Math.max(8, fs - 3), fill: hdrText, anchor: 'middle', opacity: 0.75 });
    } else text(px + colW / 2, cy(py, subH), fit(col.label, colW - 4, fs, true), { bold: true, fill: hdrText, anchor: 'middle' });
    if (showWD) {
      const wy = py + subH;
      if (st.header === 'solid') rect(px, wy, colW, wdH, mix(c.headerBg, '#ffffff', 0.16));
      text(px + colW / 2, cy(wy, wdH), String(t.cal.colDays[i]), { size: Math.max(8, fs - 3), fill: st.header === 'solid' ? hdrText : c.subtext, anchor: 'middle' });
    }
  });
  if (showWD) text(gridX - 8, tableY + groupH + subH + wdH / 2, 'working days', { size: Math.max(8, fs - 3), fill: st.header === 'solid' ? hdrText : c.subtext, anchor: 'end', italic: true });
  if (v.colTotal) text(totalX + totalW / 2, headLabelY, t.totalTitle, { bold: true, fill: hdrText, anchor: 'middle' });
  if (st.header === 'underline') rect(x0, tableY + headH - 2, tableW, 2, c.accent);

  /* ---- body ---- */
  let leafIdx = 0;
  t.rows.forEach((r, ri) => {
    const y = bodyY + ri * rowH;
    const isAgg = r.kind === 'group' || r.kind === 'total' || r.kind === 'skill';
    const bold = r.kind === 'group' || r.kind === 'total' || r.kind === 'skill' || r.kind === 'costtotal';
    let rowFill = '';
    if (r.kind === 'total') rowFill = c.totalBg;
    else if (r.kind === 'section') rowFill = mix(c.groupBg, c.bg, 0.4);
    else if (r.kind === 'group') rowFill = st.group === 'band' ? c.groupBg : st.group === 'tint' ? mix(c.groupBg, c.bg, 0.5) : '';
    else if (isLeafKind(r.kind) || r.kind === 'skill') { if (st.zebra && leafIdx++ % 2 === 1) rowFill = c.rowAlt; }
    if (rowFill) rect(x0, y, tableW, rowH, rowFill);
    const base = rowFill || c.bg;
    const labelColor = r.kind === 'total' ? c.totalText : r.kind === 'group' ? (st.group === 'band' || st.group === 'tint' ? c.groupText : c.text) : r.kind === 'capacity' || r.kind === 'section' ? c.subtext : c.text;

    // accent strip
    if (r.color && r.kind !== 'total' && r.kind !== 'capacity') rect(x0, y + 3, 4, rowH - 6, r.color, ' rx="2"');

    // label cells
    t.labelCols.forEach((col, i) => {
      const lx = labelsX[i];
      if (col.id === 'name') {
        const indent = r.level * 14 + (r.color && r.kind !== 'total' && r.kind !== 'capacity' ? 8 : 0);
        const s = r.kind === 'section' ? r.label.toUpperCase() : r.label;
        text(lx + 10 + indent, cy(y, rowH), fit(s, labelW[i] - 16 - indent, r.kind === 'section' ? fs - 2 : fs, bold),
          { bold: bold || r.kind === 'section', fill: labelColor, italic: r.kind === 'capacity', size: r.kind === 'section' ? fs - 2 : r.level === 1 && r.kind === 'capacity' ? fs - 1 : undefined });
      } else if (isLeafKind(r.kind)) {
        const s = labelText(col, r);
        const center = col.align === 'center';
        text(center ? lx + labelW[i] / 2 : lx + 10, cy(y, rowH), fit(s, labelW[i] - 16, fs), { fill: c.subtext, anchor: center ? 'middle' : 'start' });
      }
    });

    // value cells
    const interactiveIds = opts.interactive && r.allocIds.length ? ` data-alloc="${esc(r.allocIds.join(','))}"` : '';
    if (r.kind !== 'section' && r.values.length) {
      const maxV = isAgg ? t.max.agg : t.max.leaf;
      for (let i = 0; i < nCols; i++) {
        const val = r.values[i] ?? 0;
        const px = gridX + i * colW;
        const lim = r.limit?.[i];
        const isOver = lim !== undefined && val > lim + 1e-9;
        let label = r.kind === 'gap' ? (val > 0 ? '+' + fmtNum(val) : val < 0 ? '−' + fmtNum(-val) : '') : val !== 0 ? fmtOf(r)(val) : st.showZero ? '0' : '';
        let fg = r.kind === 'total' ? c.totalText : r.kind === 'capacity' ? c.subtext : c.text;
        if (r.kind === 'gap') fg = val < 0 ? c.over : c.under;
        let weight = bold || r.kind === 'gap';
        const mode = r.kind === 'capacity' || r.kind === 'gap' || r.kind === 'cost' || r.kind === 'costtotal' ? 'number' : st.cell;
        const tNorm = maxV > 0 ? Math.min(1, val / maxV) : 0;
        if (val > 0 && (r.kind !== 'total' || mode === 'heat')) {
          const accent = r.color || c.accent;
          if (mode === 'heat') {
            const bg = mix(c.heatLow, c.heatHigh, 0.08 + 0.92 * tNorm);
            rect(px + bw / 2, y + bw / 2, colW - bw, rowH - bw, bg, st.radius ? ` rx="${Math.min(st.radius, 6)}"` : '');
            fg = contrastText(bg);
          } else if (mode === 'bar' && !(r.kind === 'group')) {
            const bwid = Math.max(2, (colW - 8) * tNorm);
            rect(px + 4, y + 5, bwid, rowH - 10, mix(accent, base, 0.55), ` rx="${Math.min(3, st.radius || 2)}"`);
          } else if (mode === 'chip' && r.kind !== 'group') {
            const cw = Math.min(colW - 6, Math.max(24, textWidth(label, fs, true) + 14)), ch = Math.max(14, rowH - 10);
            rect(px + (colW - cw) / 2, y + (rowH - ch) / 2, cw, ch, accent, ` rx="${f(ch / 2)}"`);
            fg = contrastText(accent); weight = true;
          } else if (mode === 'fill' && r.kind !== 'group') {
            const bg = mix(accent, base, 0.12);
            rect(px + bw / 2, y + bw / 2, colW - bw, rowH - bw, bg);
            fg = contrastText(bg);
          }
        }
        if (isOver) {
          over.push(`<rect x="${f(px + 1.5)}" y="${f(y + 1.5)}" width="${f(colW - 3)}" height="${f(rowH - 3)}" fill="none" stroke="${c.over}" stroke-width="1.5"${st.radius ? ' rx="3"' : ''}/>`);
          if (mode === 'number' || mode === 'bar' || r.kind === 'total') fg = r.kind === 'total' ? alertOn(c.over, c.totalBg) : c.over;
          weight = true;
        }
        const [tx, anchor] = alignX(px, colW);
        // money can be wider than a narrow column: shrink it a little rather than let it spill into the next cell
        const small = r.money && textWidth(label, fs, weight) > colW - 4 ? Math.max(8, fs - 2) : r.level === 1 && r.kind === 'capacity' ? fs - 1 : undefined;
        text(tx, cy(y, rowH), label, { bold: weight, fill: fg, anchor, size: small, italic: r.kind === 'capacity' });
        if (opts.interactive && (val !== 0 || interactiveIds)) {
          const tip = r.explain ? r.explain(i) : `${r.label} · ${t.axis.cols[i].label}${t.axis.cols[i].sub ? ' ' + t.axis.cols[i].sub : ''}: ${r.kind === 'gap' ? label || '0' : fmtOf(r)(val)} (${r.money ? `cost in ${t.cost?.currency || 'currency units'}` : t.measureLabel.toLowerCase()})${isOver ? ' — over available capacity' : ''}`;
          hits.push(`<rect x="${f(px)}" y="${f(y)}" width="${colW}" height="${rowH}" fill="transparent"${interactiveIds}><title>${esc(tip)}</title></rect>`);
        }
      }
    }
    // total column
    if (opts.interactive && r.explain && v.colTotal && r.total !== null) hits.push(`<rect x="${f(totalX)}" y="${f(y)}" width="${totalW}" height="${rowH}" fill="transparent"><title>${esc(r.explain(null))}</title></rect>`);
    if (v.colTotal && r.total !== null && r.kind !== 'section') {
      const tf = r.kind === 'total' ? c.totalText : r.kind === 'capacity' ? c.subtext : c.text;
      text(totalX + totalW / 2, cy(y, rowH), fmtOf(r)(r.total), { bold: true, fill: tf, anchor: 'middle', italic: r.kind === 'capacity' });
    }
    if (opts.interactive && r.allocIds.length && !r.values.length) hits.push(`<rect x="${x0}" y="${f(y)}" width="${tableW}" height="${rowH}" fill="transparent" data-alloc="${esc(r.allocIds.join(','))}"/>`);
  });

  /* ---- borders ---- */
  const B = st.borders;
  const bodyEnd = bodyY + bodyH;
  if (B.header) {
    hline(bodyY, x0, x0 + tableW);
    if (groupH) hline(tableY + groupH, gridX, totalX);
  }
  t.rows.forEach((r, ri) => {
    const y = bodyY + ri * rowH;
    const yb = y + rowH;
    if (B.rows && ri < t.rows.length - 1) hline(yb, x0, x0 + tableW);
    if (B.groups && r.kind === 'group' && ri > 0) hline(y, x0, x0 + tableW, bw * 1.5);
    if (B.total && r.kind === 'total') { hline(y, x0, x0 + tableW, bw * 1.5); if (ri < t.rows.length - 1) hline(yb, x0, x0 + tableW, bw * 1.5); }
    if (B.groups && r.kind === 'section') hline(y, x0, x0 + tableW, bw * 1.5);
  });
  if (B.cols) {
    for (let i = 1; i < nCols; i++) vline(gridX + i * colW, tableY + groupH, bodyEnd);
    if (groupH) for (const g of t.axis.groups.slice(1)) vline(gridX + g.x, tableY, tableY + groupH);
  }
  if (B.labels) {
    for (let i = 1; i < t.labelCols.length; i++) vline(labelsX[i], tableY, bodyEnd);
    vline(gridX, tableY, bodyEnd);
    if (v.colTotal) vline(totalX, tableY, bodyEnd);
  }

  const frame = B.outer ? `<rect x="${f(x0 + off)}" y="${f(tableY + off)}" width="${f(tableW - (off ? 1 : 0))}" height="${f(tableH - (off ? 1 : 0))}" fill="none" stroke="${c.border}" stroke-width="${f(bw)}"${st.radius ? ` rx="${st.radius}"` : ''}${dashAttr}/>` : '';

  /* ---- legend / footer ---- */
  const legendTop = tableY + tableH + 14;
  const legend: string[] = [];
  let legendH = 0, legendW = 0;
  if (v.showLegend) {
    const items: { w: number; draw: (x: number, y: number) => string }[] = [];
    const sm = Math.max(9, fs - 1);
    const label = (s: string) => ({ w: textWidth(s, sm) + 4, draw: (x: number, y: number) => `<text x="${f(x)}" y="${f(y + sm * 0.35)}" font-size="${sm}" fill="${c.subtext}">${esc(s)}</text>` });
    items.push(label(`Cells: ${t.measureLabel.toLowerCase()}`));
    const usedWs = new Set(p.allocations.map(a => a.workstreamId));
    for (const w of p.workstreams) {
      if (!usedWs.has(w.id)) continue;
      items.push({ w: 14 + textWidth(w.name, sm), draw: (x, y) => `<rect x="${f(x)}" y="${f(y - 5)}" width="10" height="10" rx="2" fill="${w.color}"/><text x="${f(x + 14)}" y="${f(y + sm * 0.35)}" font-size="${sm}" fill="${c.text}">${esc(w.name)}</text>` });
    }
    if (st.cell === 'heat') {
      const steps = 5;
      items.push({ w: 6 * steps + 70, draw: (x, y) => `<text x="${f(x)}" y="${f(y + sm * 0.35)}" font-size="${sm}" fill="${c.subtext}">low</text>` +
        Array.from({ length: steps }, (_, i) => `<rect x="${f(x + 24 + i * 12)}" y="${f(y - 6)}" width="12" height="12" fill="${mix(c.heatLow, c.heatHigh, 0.08 + 0.92 * i / (steps - 1))}"/>`).join('') +
        `<text x="${f(x + 24 + steps * 12 + 6)}" y="${f(y + sm * 0.35)}" font-size="${sm}" fill="${c.subtext}">high</text>` });
    }
    if (t.rows.some(r => r.limit && r.values.some((x, i) => x > (r.limit![i] ?? Infinity) + 1e-9))) {
      items.push({ w: 18 + textWidth('Over available capacity', sm), draw: (x, y) => `<rect x="${f(x + 1)}" y="${f(y - 5)}" width="10" height="10" fill="none" stroke="${c.over}" stroke-width="1.5"/><text x="${f(x + 16)}" y="${f(y + sm * 0.35)}" font-size="${sm}" fill="${c.text}">Over available capacity</text>` });
    }
    items.push(label(`Working days: ${workDaysLabel(p.workDays)}`));
    if (t.cost) {
      items.push(label(`Cost${t.cost.currency ? ` in ${t.cost.currency}` : ''} · 1 person-month = ${fmtNum(t.cost.pmDays)} working days${t.cost.pmAuto ? ' (automatic)' : ''}`));
      const n = t.cost.unpriced;
      if (n > 0) {
        const msg = `${n} resource line${n === 1 ? '' : 's'} not priced — no rate`;
        items.push({ w: textWidth(msg, sm) + 4, draw: (x, y) => `<text x="${f(x)}" y="${f(y + sm * 0.35)}" font-size="${sm}" fill="${c.over}">${esc(msg)}</text>` });
      }
    }
    const maxW = Math.max(tableW, 420);
    let x = 0, row = 0;
    const pos: { x: number; row: number; w: number; i: number }[] = [];
    items.forEach((it, i) => {
      if (x > 0 && x + it.w > maxW) { x = 0; row++; }
      pos.push({ x, row, w: it.w, i }); x += it.w + 18; legendW = Math.max(legendW, x - 18);
    });
    const lh = Math.round(sm * 1.9);
    for (const q of pos) legend.push(items[q.i].draw(x0 + q.x, legendTop + q.row * lh + lh / 2));
    legendH = (pos.length ? pos[pos.length - 1].row + 1 : 0) * lh + 8;
  }
  const footerY = legendTop + legendH + (p.footerText ? 8 : 0);
  const footerH = p.footerText ? Math.round(fs * 1.8) : 0;

  /* ---- title ---- */
  const title: string[] = [];
  let titleW = 0;
  if (titleOn) {
    const big = Math.round(fs * 1.6);
    if (st.title === 'banner') {
      title.push(`<rect x="${x0}" y="${PAD}" width="${tableW}" height="${bannerH}" fill="${c.headerBg}"${st.radius ? ` rx="${Math.min(st.radius, 10)}"` : ''}/>`);
      title.push(`<text x="${x0 + 14}" y="${f(PAD + bannerH / 2 + big * 0.35)}" font-size="${big}" font-weight="700" fill="${c.headerText}">${esc(fit(p.title, tableW * 0.6, big, true))}</text>`);
      if (p.subtitle) title.push(`<text x="${x0 + tableW - 14}" y="${f(PAD + bannerH / 2 + fs * 0.35)}" font-size="${fs}" text-anchor="end" fill="${c.headerText}" opacity="0.85">${esc(fit(p.subtitle, tableW * 0.38, fs))}</text>`);
      titleW = tableW;
    } else {
      const center = st.title === 'center';
      const tx = center ? x0 + tableW / 2 : x0, anchor = center ? ' text-anchor="middle"' : '';
      title.push(`<text x="${f(tx)}" y="${f(PAD + big * 0.9)}" font-size="${big}" font-weight="700" fill="${c.title}"${anchor}>${esc(p.title)}</text>`);
      if (p.subtitle) title.push(`<text x="${f(tx)}" y="${f(PAD + big * 0.9 + fs * 1.5)}" font-size="${fs}" fill="${c.subtext}"${anchor}>${esc(p.subtitle)}</text>`);
      titleW = center ? tableW : Math.max(textWidth(p.title, big, true), textWidth(p.subtitle, fs));
    }
  }

  const width = Math.ceil(PAD * 2 + Math.max(tableW, titleW, legendW));
  const height = Math.ceil((v.showLegend || p.footerText ? footerY + footerH : tableY + tableH) + PAD);
  const clip = st.radius ? `<clipPath id="tclip"><rect x="${x0}" y="${tableY}" width="${tableW}" height="${tableH}" rx="${st.radius}"/></clipPath>` : '';
  const empty = t.empty
    ? `<text x="${f(x0 + tableW / 2)}" y="${f(bodyY + rowH * 1.5)}" font-size="${fs + 1}" text-anchor="middle" fill="${c.subtext}">Nothing is loaded yet — add rows under “Resource loading”.</text>` : '';
  const emptyPad = t.empty ? rowH * 3 : 0;

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + emptyPad}" viewBox="0 0 ${width} ${height + emptyPad}" ${font}>`);
  out.push(`<rect width="${width}" height="${height + emptyPad}" fill="${c.bg}"/>`);
  if (clip) out.push(`<defs>${clip}</defs>`);
  out.push(...title);
  out.push(`<g${clip ? ' clip-path="url(#tclip)"' : ''}>${fills.join('')}</g>`);
  out.push(`<g stroke="${c.border}" fill="none"${dashAttr}>${lines.join('')}</g>`);
  out.push(frame);
  out.push(over.join(''));
  out.push(`<g>${texts.join('')}</g>`);
  out.push(empty);
  out.push(...legend);
  if (p.footerText) out.push(`<text x="${x0}" y="${f(footerY + footerH / 2 + fs * 0.1)}" font-size="${Math.max(9, fs - 1)}" fill="${c.subtext}">${esc(p.footerText)}</text>`);
  out.push(`<g>${hits.join('')}</g>`);
  out.push('</svg>');
  return { svg: out.join(''), width, height: height + emptyPad };
}
