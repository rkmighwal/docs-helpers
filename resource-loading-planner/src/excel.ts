import { HolidayList, Project, Theme, allocRange, resourceLabel } from './model';
import { TableModel, buildTable, isLeafKind, labelCell } from './table';
import { XBorder, XCell, XSheet, XStyle, buildXlsx, excelDate, rangeRef } from './xlsx';
import { alertOn, contrastText, legible, mix } from './color';
import { DOW } from './dates';
import { workDaysLabel } from './render';
import { aggregate, buildCalendar, dailyLoad, overall, resourceUtilisation } from './calc';
import { costActive, costDaily, costSummary, excelMoneyFormat } from './cost';
import { fmtNum } from './table';
import { buildAxis } from './scale';

export interface XlsxOptions {
  /** Include the Cost sheet and the rate column of the Resources sheet. Default: the project's setting. */
  costSheet?: boolean;
  /** Include the cost rows in the plan sheet. Default: the project's setting. */
  costRows?: boolean;
}

/** Builds the workbook: the formatted plan (as shown in the preview), the data behind it and, if wanted, a Cost sheet. */
export function exportXlsx(p: Project, theme: Theme, holidayLists: HolidayList[], o: XlsxOptions = {}): Uint8Array {
  const holidays = holidayLists.flatMap(l => l.holidays.map(h => h.date));
  const withSheet = costActive(p) && (o.costSheet ?? p.cost.exportSheet);
  const withRows = costActive(p) && (o.costRows ?? p.cost.exportRows);
  const t = buildTable(p, holidays, { cost: withRows }); // with cost excluded, no figure of it appears anywhere in the workbook
  return buildXlsx([
    planSheet(p, theme, t),
    ...(withSheet ? [costSheet(p, theme, holidays)] : []),
    allocationSheet(p, theme), resourceSheet(p, theme, holidays, withSheet), calendarSheet(p, theme, holidayLists),
  ]);
}

function planSheet(p: Project, theme: Theme, t: TableModel): XSheet {
  const c = theme.colors, st = p.style, v = p.view, B = st.borders;
  const font = theme.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  const fsz = Math.max(9, Math.min(14, theme.fontSize - 1));
  const rows: (XCell | undefined)[][] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};
  const nLabel = t.labelCols.length, nCols = t.axis.cols.length;
  const firstPeriod = nLabel, totalCol = nLabel + nCols, lastCol = v.colTotal ? totalCol : totalCol - 1;
  const base = (s: XStyle = {}): XStyle => ({ font, size: fsz, color: c.text, valign: 'center', ...s });
  const put = (r: number, col: number, cell: XCell) => { (rows[r] ||= [])[col] = cell; };

  /* ---- title block ---- */
  let r = 0;
  if (v.showTitle && (p.title || p.subtitle)) {
    put(r, 0, { v: p.title, s: base({ bold: true, size: 16, color: c.title }) }); rowHeights[r] = 26; r++;
    if (p.subtitle) { put(r, 0, { v: p.subtitle, s: base({ color: c.subtext }) }); r++; }
  }
  put(r, 0, { v: `Cells show: ${t.measureLabel.toLowerCase()} · Working days: ${workDaysLabel(p.workDays)}`, s: base({ italic: true, color: c.subtext, size: fsz - 1 }) });
  r += 2;

  /* ---- header ---- */
  const hdrFill = st.header === 'solid' ? c.headerBg : undefined;
  const hdrText = st.header === 'solid' ? c.headerText : legible(c.headerText, c.bg, c.text);
  const hs = (extra: XStyle = {}): XStyle => base({ bold: true, color: hdrText, fill: hdrFill, align: 'center', wrap: true, ...extra });
  const hasGroups = t.axis.groups.length > 0, showWD = v.showWorkingDays && p.useDates;
  const headTop = r;
  const gRow = hasGroups ? r : -1, pRow = r + (hasGroups ? 1 : 0), wRow = showWD ? pRow + 1 : -1;
  const headBottom = showWD ? wRow : pRow;
  t.labelCols.forEach((col, i) => put(headTop, i, { v: col.title, s: hs({ align: col.align === 'left' ? 'left' : 'center', indent: col.align === 'left' ? 1 : 0 }) }));
  for (let rr = headTop; rr <= headBottom; rr++) for (let i = 0; i < nLabel; i++) if (rr > headTop) put(rr, i, { s: hs() });
  if (headBottom > headTop) for (let i = 0; i < nLabel; i++) merges.push(rangeRef(headTop, i, headBottom, i));
  if (hasGroups) {
    const gs = hs({ fill: st.header === 'solid' ? mix(c.headerBg, '#000000', 0.16) : undefined });
    let col = firstPeriod;
    for (const g of t.axis.groups) {
      const span = Math.round(g.w / t.axis.colW);
      for (let k = 0; k < span; k++) put(gRow, col + k, { v: k === 0 ? g.label : undefined, s: gs });
      if (span > 1) merges.push(rangeRef(gRow, col, gRow, col + span - 1));
      col += span;
    }
  }
  t.axis.cols.forEach((col, i) => put(pRow, firstPeriod + i, { v: col.sub ? `${col.label}\n${col.sub}` : col.label, s: hs() }));
  if (col0HasSub(t)) rowHeights[pRow] = 32;
  if (showWD) t.axis.cols.forEach((_, i) => put(wRow, firstPeriod + i, { v: t.cal.colDays[i], s: hs({ bold: false, size: fsz - 1, fill: st.header === 'solid' ? mix(c.headerBg, '#ffffff', 0.16) : undefined }) }));
  if (v.colTotal) {
    put(headTop, totalCol, { v: t.totalTitle, s: hs() });
    for (let rr = headTop + 1; rr <= headBottom; rr++) put(rr, totalCol, { s: hs() });
    if (headBottom > headTop) merges.push(rangeRef(headTop, totalCol, headBottom, totalCol));
  }
  const bodyStart = headBottom + 1;

  /* ---- body ---- */
  let leaf = 0;
  const rowStyles: { fill?: string; bold: boolean; color: string }[] = [];
  t.rows.forEach((row, ri) => {
    const rr = bodyStart + ri;
    const agg = row.kind === 'group' || row.kind === 'total' || row.kind === 'skill';
    const bold = row.kind === 'group' || row.kind === 'total' || row.kind === 'skill' || row.kind === 'costtotal';
    let fill: string | undefined;
    if (row.kind === 'total') fill = c.totalBg;
    else if (row.kind === 'section') fill = mix(c.groupBg, c.bg, 0.4);
    else if (row.kind === 'group') fill = st.group === 'band' ? c.groupBg : st.group === 'tint' ? mix(c.groupBg, c.bg, 0.5) : undefined;
    else if (isLeafKind(row.kind) || row.kind === 'skill') { if (st.zebra && leaf++ % 2 === 1) fill = c.rowAlt; }
    const labelColor = row.kind === 'total' ? c.totalText : row.kind === 'group' ? (st.group === 'band' || st.group === 'tint' ? c.groupText : c.text) : row.kind === 'capacity' || row.kind === 'section' ? c.subtext : c.text;
    rowStyles.push({ fill, bold, color: labelColor });
    t.labelCols.forEach((col, i) => {
      const s = base({ bold: bold || row.kind === 'section', italic: row.kind === 'capacity', color: col.id === 'name' ? labelColor : c.subtext, fill, align: col.align, indent: col.id === 'name' ? row.level * 2 + 1 : 0 });
      const val = row.kind === 'section' ? row.label.toUpperCase() : labelCell(col, row);
      put(rr, i, { v: isLeafKind(row.kind) || col.id === 'name' ? val : undefined, s });
    });
    const maxV = agg ? t.max.agg : t.max.leaf;
    for (let i = 0; i < nCols; i++) {
      const val = row.values[i] ?? 0;
      let cellFill = fill, fg = row.kind === 'total' ? c.totalText : row.kind === 'capacity' ? c.subtext : c.text, weight = bold || row.kind === 'gap';
      const mode = row.kind === 'capacity' || row.kind === 'gap' || row.kind === 'cost' || row.kind === 'costtotal' ? 'number' : st.cell;
      const tn = maxV > 0 ? Math.min(1, val / maxV) : 0;
      const accent = row.color || c.accent;
      if (row.kind === 'gap') fg = val < 0 ? c.over : c.under;
      if (val > 0 && (row.kind !== 'total' || mode === 'heat') && row.kind !== 'section') {
        if (mode === 'heat') { cellFill = mix(c.heatLow, c.heatHigh, 0.08 + 0.92 * tn); fg = contrastText(cellFill); }
        else if (mode === 'bar' && row.kind !== 'group') cellFill = mix(fill ?? c.bg, accent, 0.12 + 0.5 * tn);
        else if (mode === 'chip' && row.kind !== 'group') { cellFill = accent; fg = contrastText(accent); weight = true; }
        else if (mode === 'fill' && row.kind !== 'group') { cellFill = mix(accent, fill ?? c.bg, 0.12); fg = contrastText(cellFill); }
      }
      const lim = row.limit?.[i];
      if (lim !== undefined && val > lim + 1e-9) { fg = row.kind === 'total' ? alertOn(c.over, c.totalBg) : c.over; weight = true; if (row.kind !== 'total') cellFill = mix(c.over, fill ?? c.bg, 0.85); }
      const label = row.kind === 'section' ? undefined : row.values.length ? val : undefined;
      put(rr, firstPeriod + i, { v: label === undefined ? undefined : val === 0 && !st.showZero ? undefined : label, s: base({ bold: weight, italic: row.kind === 'capacity', color: fg, fill: cellFill, align: st.align, numFmt: row.money ? excelMoneyFormat(p.cost.currency, 0) : row.kind === 'gap' ? '+0.##;−0.##;' : undefined }) });
    }
    if (v.colTotal) put(rr, totalCol, { v: row.total === null || row.kind === 'section' ? undefined : row.total, s: base({ bold: true, italic: row.kind === 'capacity', color: row.kind === 'total' ? c.totalText : row.kind === 'capacity' ? c.subtext : c.text, fill, align: 'center', numFmt: row.money ? excelMoneyFormat(p.cost.currency, 0) : undefined }) });
  });
  const bodyEnd = bodyStart + t.rows.length - 1;

  /* ---- borders ---- */
  const bw = st.borderWidth;
  const kind: XBorder['style'] = st.borderStyle === 'dashed' ? 'dashed' : st.borderStyle === 'dotted' ? 'dotted' : bw >= 2 ? 'medium' : 'thin';
  const line: XBorder = { style: kind, color: c.border };
  const heavy: XBorder = { style: st.borderStyle === 'solid' ? 'medium' : kind, color: c.border };
  const side = (rr: number, cc: number, which: 'l' | 'r' | 't' | 'b', b: XBorder) => {
    const cell = (rows[rr] ||= [])[cc] ||= {};
    cell.s = { ...(cell.s ?? {}), border: { ...(cell.s?.border ?? {}), [which]: b } };
  };
  const rowSpan = (rr: number, which: 't' | 'b', b: XBorder) => { for (let cc = 0; cc <= lastCol; cc++) side(rr, cc, which, b); };
  const hdrLine: XBorder = { style: kind, color: st.header === 'solid' ? mix(c.headerBg, '#ffffff', 0.3) : c.border };
  if (B.header) { rowSpan(headBottom, 'b', line); if (hasGroups) for (let cc = firstPeriod; cc < totalCol; cc++) side(gRow, cc, 'b', line); }
  t.rows.forEach((row, ri) => {
    const rr = bodyStart + ri;
    if (B.rows && ri < t.rows.length - 1) rowSpan(rr, 'b', line);
    if (B.groups && (row.kind === 'group' || row.kind === 'section') && ri > 0) rowSpan(rr, 't', heavy);
    if (B.total && row.kind === 'total') { rowSpan(rr, 't', heavy); rowSpan(rr, 'b', heavy); }
  });
  if (B.cols) {
    for (let rr = headTop; rr <= bodyEnd; rr++) {
      if (rr === gRow) continue;
      for (let cc = firstPeriod; cc < totalCol; cc++) side(rr, cc, 'r', rr <= headBottom ? hdrLine : line);
    }
    if (hasGroups) { let col = firstPeriod; for (const g of t.axis.groups) { col += Math.round(g.w / t.axis.colW); side(gRow, col - 1, 'r', hdrLine); } }
  }
  if (B.labels) {
    for (let rr = headTop; rr <= bodyEnd; rr++) {
      for (let cc = 0; cc < nLabel; cc++) side(rr, cc, 'r', rr <= headBottom ? hdrLine : line);
      if (v.colTotal) side(rr, totalCol - 1, 'r', rr <= headBottom ? hdrLine : line);
    }
  }
  if (B.outer) {
    for (let cc = 0; cc <= lastCol; cc++) { side(headTop, cc, 't', heavy); side(bodyEnd, cc, 'b', heavy); }
    for (let rr = headTop; rr <= bodyEnd; rr++) { side(rr, 0, 'l', heavy); side(rr, lastCol, 'r', heavy); }
  }

  /* ---- footer ---- */
  let fr = bodyEnd + 2;
  if (t.cost) put(fr++, 0, { v: `Cost${t.cost.currency ? ` in ${t.cost.currency}` : ''} · 1 person-month = ${fmtNum(t.cost.pmDays)} working days${t.cost.pmAuto ? ' (automatic)' : ''}${t.cost.unpriced ? ` · ${t.cost.unpriced} resource line(s) not priced (no rate)` : ''}`, s: base({ italic: true, color: c.subtext, size: fsz - 1 }) });
  if (p.footerText) put(fr++, 0, { v: p.footerText, s: base({ italic: true, color: c.subtext, size: fsz - 1 }) });
  if (t.empty) put(fr, 0, { v: 'Nothing is loaded yet — add rows under “Resource loading”.', s: base({ italic: true, color: c.subtext }) });

  const nameW = Math.min(46, Math.max(22, ...t.rows.map(x => x.label.length + x.level * 2 + 3), t.labelCols[0].title.length + 2));
  const colWidths = [
    nameW,
    ...t.labelCols.slice(1).map(col => (col.id === 'start' || col.id === 'end' ? 12 : col.id === 'qty' ? 7 : Math.min(30, Math.max(12, ...t.rows.map(x => labelCell(col, x).length + 2))))),
    ...t.axis.cols.map(() => Math.max(6, Math.round(t.axis.colW / 6.5))),
    ...(v.colTotal ? [9] : []),
  ];
  // the title cell is long: let it overflow into the empty cells to its right (no merge, so the sheet stays easy to edit)
  return { name: 'Loading plan', rows, colWidths, rowHeights, merges, freeze: { rows: headBottom + 1, cols: 1 }, showGrid: false, tabColor: c.accent };
}

const col0HasSub = (t: TableModel) => t.axis.cols.some(x => x.sub);

function headerStyle(theme: Theme): XStyle {
  return { bold: true, color: contrastText(theme.colors.headerBg), fill: theme.colors.headerBg, valign: 'center', align: 'left' };
}

function allocationSheet(p: Project, theme: Theme): XSheet {
  const ws = new Map(p.workstreams.map(w => [w.id, w.name])), sk = new Map(p.skills.map(s => [s.id, s.name]));
  const rs = new Map(p.resources.map(r => [r.id, resourceLabel(r, p.skills)]));
  const head = ['Work stream', 'Skill', 'Resource', 'Task', 'Label', p.useDates ? 'Start' : 'Start period', p.useDates ? 'End' : 'End period', 'Count', 'Note'];
  const hs = headerStyle(theme);
  const rows: (XCell | undefined)[][] = [head.map(h => ({ v: h, s: hs }))];
  const date = (iso: string): XCell => (p.useDates ? { v: excelDate(iso), s: { numFmt: 'yyyy-mm-dd', align: 'left' } } : { v: iso });
  for (const a of p.allocations) {
    const r = allocRange(a, p);
    const task = a.taskId ? p.tasks.find(x => x.id === a.taskId)?.name : '';
    rows.push([{ v: ws.get(a.workstreamId) ?? '' }, { v: sk.get(a.skillId) ?? '' }, { v: a.resourceId ? rs.get(a.resourceId) ?? '' : '' }, { v: task ?? '' }, { v: a.label },
      p.useDates ? date(r.start) : { v: fmtPeriod(p, r.start) }, p.useDates ? date(r.end) : { v: fmtPeriod(p, r.end) }, { v: a.count }, { v: a.note ?? '' }]);
  }
  return { name: 'Allocations', rows, colWidths: [20, 20, 18, 28, 24, 13, 13, 8, 30], freeze: { rows: 1, cols: 0 }, autoFilter: rangeRef(0, 0, Math.max(1, rows.length - 1), head.length - 1), tabColor: theme.colors.headerBg };
}

function fmtPeriod(p: Project, iso: string): string {
  const axis = buildAxis(p);
  const i = axis.cols.findIndex(c => iso >= c.start && iso < c.next);
  return i >= 0 ? axis.cols[i].label : iso;
}

function resourceSheet(p: Project, theme: Theme, holidays: string[], withRate: boolean): XSheet {
  const sk = new Map(p.skills.map(s => [s.id, s.name])), ws = new Map(p.workstreams.map(w => [w.id, w.name]));
  const cal = buildCalendar(buildAxis(p), p.workDays, p.useDates ? holidays : []);
  const head = ['Resource', 'Primary skill', 'Other skills', 'Availability (FTE)', 'Home work stream', 'Available from', 'Available to', 'Peak load vs availability', ...(withRate ? [`Cost per person-day${p.cost.currency ? ` (${p.cost.currency})` : ''}`] : []), 'Note'];
  const rows: (XCell | undefined)[][] = [head.map(h => ({ v: h, s: headerStyle(theme) }))];
  for (const r of p.resources) {
    const u = resourceUtilisation(p, cal, r.id);
    rows.push([{ v: r.name }, { v: sk.get(r.skillIds[0]) ?? '' }, { v: r.skillIds.slice(1).map(s => sk.get(s)).filter(Boolean).join(', ') }, { v: r.fte },
      { v: ws.get(r.workstreamId ?? '') ?? '' }, r.from && p.useDates ? { v: excelDate(r.from), s: { numFmt: 'yyyy-mm-dd', align: 'left' } } : { v: '' },
      r.to && p.useDates ? { v: excelDate(r.to), s: { numFmt: 'yyyy-mm-dd', align: 'left' } } : { v: '' },
      { v: Number.isFinite(u.peak) ? Math.round(u.peak * 100) / 100 : 'unavailable', s: { numFmt: '0%', align: 'left', ...(u.peak > 1 + 1e-9 ? { color: theme.colors.over, bold: true } : {}) } },
      ...(withRate ? [r.dayRate ? { v: r.dayRate, s: { numFmt: excelMoneyFormat(p.cost.currency, 2), align: 'left' as const } } : { v: '' }] : []), { v: r.note ?? '' }]);
  }
  return { name: 'Resources', rows, colWidths: [22, 20, 28, 16, 20, 14, 14, 24, ...(withRate ? [22] : []), 30], freeze: { rows: 1, cols: 0 }, autoFilter: rangeRef(0, 0, Math.max(1, rows.length - 1), head.length - 1), tabColor: theme.colors.headerBg };
}

function calendarSheet(p: Project, theme: Theme, lists: HolidayList[]): XSheet {
  const hs = headerStyle(theme);
  const rows: (XCell | undefined)[][] = [[{ v: 'Day of week', s: hs }, { v: 'Counts as working day', s: hs }, undefined, { v: 'Holiday date', s: hs }, { v: 'Holiday', s: hs }, { v: 'List', s: hs }]];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const hol: { date: string; name: string; list: string }[] = [];
  if (p.useDates) for (const l of lists) if (p.holidayListIds.includes(l.id)) for (const h of l.holidays) hol.push({ ...h, list: l.name });
  hol.sort((a, b) => a.date.localeCompare(b.date));
  const n = Math.max(order.length, hol.length);
  for (let i = 0; i < n; i++) {
    const row: (XCell | undefined)[] = [];
    if (i < order.length) { row[0] = { v: DOW[order[i]] }; row[1] = { v: p.workDays.includes(order[i]) ? 'Yes' : 'No' }; }
    if (i < hol.length) { row[3] = { v: excelDate(hol[i].date), s: { numFmt: 'yyyy-mm-dd', align: 'left' } }; row[4] = { v: hol[i].name }; row[5] = { v: hol[i].list }; }
    rows.push(row);
  }
  return { name: 'Calendar', rows, colWidths: [16, 22, 4, 14, 32, 22], freeze: { rows: 1, cols: 0 }, tabColor: theme.colors.headerBg };
}

/**
 * The Cost sheet: the person-month definition (editable — the month rates, person-months and costs below are
 * formulas on it), a rate card with totals, and the cost per period for each work stream.
 */
function costSheet(p: Project, theme: Theme, holidays: string[]): XSheet {
  const c = theme.colors;
  const font = theme.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  const fsz = Math.max(9, Math.min(14, theme.fontSize - 1));
  const axis = buildAxis(p);
  const cal = buildCalendar(axis, p.workDays, p.useDates ? holidays : []);
  const sum = costSummary(p, cal);
  const cur = p.cost.currency;
  const r2 = (v: number) => Math.round((v + 1e-9) * 100) / 100;
  const base = (s: XStyle = {}): XStyle => ({ font, size: fsz, color: c.text, valign: 'center', ...s });
  const head = (s: XStyle = {}): XStyle => base({ bold: true, color: c.headerText, fill: c.headerBg, align: 'center', wrap: true, ...s });
  const line: XBorder = { style: 'thin', color: c.border };
  const rows: (XCell | undefined)[][] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};
  const put = (r: number, col: number, cell: XCell) => { (rows[r] ||= [])[col] = cell; };

  put(0, 0, { v: `Cost — ${p.title}`, s: base({ bold: true, size: 16, color: c.title }) }); rowHeights[0] = 26;
  put(1, 0, { v: `All amounts in ${cur || 'currency units'}. Cost = person-days loaded × cost per person-day.`, s: base({ italic: true, color: c.subtext }) });

  // the person-month definition: one input cell everything below refers to
  const PM_ROW = 3, pmRef = `$B$${PM_ROW + 1}`;
  put(PM_ROW, 0, { v: 'Working days in one person-month', s: base({ bold: true }) });
  put(PM_ROW, 1, { v: sum.pmDays, s: base({ bold: true, fill: '#fff4c2', align: 'center', border: { l: line, r: line, t: line, b: line } }) });
  put(PM_ROW, 2, { v: 'Change this number and the month rates, person-months and costs below recalculate.', s: base({ italic: true, color: c.subtext }) });
  put(PM_ROW + 1, 0, { v: 'Basis', s: base({ color: c.subtext }) });
  put(PM_ROW + 1, 1, { v: sum.pmAuto ? `Automatic: ${p.workDays.length} working days a week × 52 weeks ÷ 12 months` : 'Set manually in the planner', s: base({ color: c.subtext }) });

  // rate card
  let r = PM_ROW + 3;
  put(r++, 0, { v: 'Rates and totals', s: base({ bold: true, size: fsz + 2, color: c.title }) });
  ['Resource / skill', 'Rate applies to', `Cost per person-day`, `Cost per person-month`, 'Person-days loaded', 'Person-months', `Cost`].forEach((h, i) => put(r, i, { v: h, s: head({ align: i < 2 ? 'left' : 'center' }) }));
  rowHeights[r] = 32;
  r++;
  const first = r;
  const money = excelMoneyFormat(cur, 2), whole = excelMoneyFormat(cur, 0), num = '#,##0.##';
  const sumDays = (pred: (l: (typeof sum.lines)[number]) => boolean) => r2(sum.lines.filter(pred).reduce((n, l) => n + l.personDays, 0));
  const rateRow = (name: string, kind: string, rate: number, days: number) => {
    const n = r + 1; // 1-based sheet row
    const cell = (extra: XStyle = {}) => base({ border: { b: line }, ...extra });
    put(r, 0, { v: name, s: cell() });
    put(r, 1, { v: kind, s: cell({ color: c.subtext }) });
    put(r, 2, { v: rate, s: cell({ align: 'center', numFmt: money }) });
    put(r, 3, { v: r2(rate * sum.pmDays), f: `C${n}*${pmRef}`, s: cell({ align: 'center', numFmt: money }) });
    put(r, 4, { v: days, s: cell({ align: 'center', numFmt: num }) });
    put(r, 5, { v: sum.pmDays > 0 ? r2(days / sum.pmDays) : 0, f: `E${n}/${pmRef}`, s: cell({ align: 'center', numFmt: num }) });
    put(r, 6, { v: r2(days * rate), f: `E${n}*C${n}`, s: cell({ align: 'center', numFmt: money }) });
    r++;
  };
  for (const res of p.resources) if ((res.dayRate ?? 0) > 0) rateRow(resourceLabel(res, p.skills), 'Named resource — own rate', res.dayRate!, sumDays(l => l.source === 'resource' && l.alloc.resourceId === res.id));
  for (const s of p.skills) if ((s.dayRate ?? 0) > 0) rateRow(s.name, 'Skill — standard rate (lines with no own rate)', s.dayRate!, sumDays(l => l.source === 'skill' && l.skillId === s.id));
  const unpricedDays = sumDays(l => l.source === 'none');
  if (unpricedDays > 0) {
    const n = r + 1, cell = (extra: XStyle = {}) => base({ border: { b: line }, color: c.over, ...extra });
    put(r, 0, { v: 'Not priced', s: cell() });
    put(r, 1, { v: 'No rate defined for these lines', s: cell() });
    put(r, 4, { v: unpricedDays, s: cell({ align: 'center', numFmt: num }) });
    put(r, 5, { v: sum.pmDays > 0 ? r2(unpricedDays / sum.pmDays) : 0, f: `E${n}/${pmRef}`, s: cell({ align: 'center', numFmt: num }) });
    r++;
  }
  const last = r - 1;
  const tot = (extra: XStyle = {}) => base({ bold: true, fill: c.totalBg, color: c.totalText, align: 'center', ...extra });
  put(r, 0, { v: 'Total', s: tot({ align: 'left' }) });
  put(r, 1, { s: tot() }); put(r, 2, { s: tot() }); put(r, 3, { s: tot() });
  const pricedCost = sum.totalCost;
  if (last >= first) {
    put(r, 4, { v: sum.totalPersonDays, f: `SUM(E${first + 1}:E${last + 1})`, s: tot({ numFmt: num }) });
    put(r, 5, { v: sum.personMonths, f: `SUM(F${first + 1}:F${last + 1})`, s: tot({ numFmt: num }) });
    put(r, 6, { v: pricedCost, f: `SUM(G${first + 1}:G${last + 1})`, s: tot({ numFmt: money }) });
  } else {
    put(r, 4, { v: 0, s: tot() }); put(r, 5, { v: 0, s: tot() }); put(r, 6, { v: 0, s: tot() });
  }
  r += 3;

  // cost per period and work stream
  put(r++, 0, { v: `Cost per ${p.scale}`, s: base({ bold: true, size: fsz + 2, color: c.title }) });
  const n = axis.cols.length, totalCol = 1 + n;
  const hasGroups = axis.groups.length > 0;
  const gRow = r, pRow = r + (hasGroups ? 1 : 0);
  // when a group row sits above the periods, the labels that span both header rows live in the top row (the merged cell's value)
  put(hasGroups ? gRow : pRow, 0, { v: 'Work stream', s: head({ align: 'left' }) });
  if (hasGroups) {
    put(pRow, 0, { s: head() });
    merges.push(rangeRef(gRow, 0, pRow, 0));
    let col = 1;
    for (const g of axis.groups) {
      const span = Math.round(g.w / axis.colW);
      for (let k = 0; k < span; k++) put(gRow, col + k, { v: k === 0 ? g.label : undefined, s: head({ fill: mix(c.headerBg, '#000000', 0.16) }) });
      if (span > 1) merges.push(rangeRef(gRow, col, gRow, col + span - 1));
      col += span;
    }
    put(gRow, totalCol, { v: 'Total', s: head() });
    put(pRow, totalCol, { s: head() });
    merges.push(rangeRef(gRow, totalCol, pRow, totalCol));
  }
  axis.cols.forEach((col, i) => put(pRow, 1 + i, { v: col.sub ? `${col.label}\n${col.sub}` : col.label, s: head() }));
  if (!hasGroups) put(pRow, totalCol, { v: 'Total', s: head() });
  if (axis.cols.some(x => x.sub)) rowHeights[pRow] = 32;
  r = pRow + 1;
  const buckets = new Map<string, typeof p.allocations>();
  for (const a of p.allocations) (buckets.get(a.workstreamId) ?? buckets.set(a.workstreamId, []).get(a.workstreamId)!).push(a);
  const order = [...p.workstreams.map(w => w.id), ''].filter(id => buckets.has(id));
  const moneyRow = (label: string, d: Float64Array, bold: boolean, fill?: string, color?: string) => {
    const vals = aggregate(d, cal, 'days');
    const cell = (extra: XStyle = {}) => base({ bold, fill, color: color ?? c.text, border: { b: line }, ...extra });
    put(r, 0, { v: label, s: cell({ indent: 1 }) });
    vals.forEach((x, i) => put(r, 1 + i, { v: x === 0 ? undefined : x, s: cell({ align: 'center', numFmt: whole }) }));
    put(r, totalCol, { v: overall(d, cal, 'days'), s: cell({ bold: true, align: 'center', numFmt: whole }) });
    r++;
  };
  for (const id of order) moneyRow(p.workstreams.find(w => w.id === id)?.name ?? 'No work stream', costDaily(buckets.get(id)!, p, cal), false);
  moneyRow('Total cost', costDaily(p.allocations, p, cal), true, c.totalBg, c.totalText);
  const effort = aggregate(dailyLoad(p.allocations, p, cal), cal, 'days').map(x => (sum.pmDays > 0 ? r2(x / sum.pmDays) : 0));
  put(r, 0, { v: 'Effort (person-months)', s: base({ italic: true, color: c.subtext, indent: 1 }) });
  effort.forEach((x, i) => put(r, 1 + i, { v: x === 0 ? undefined : x, s: base({ italic: true, color: c.subtext, align: 'center', numFmt: num }) }));
  put(r, totalCol, { v: sum.personMonths, s: base({ italic: true, bold: true, color: c.subtext, align: 'center', numFmt: num }) });
  r += 2;
  if (sum.unpriced) put(r, 0, { v: `${sum.unpriced} resource line(s) have no rate and are not priced — set a rate on the resource or on its skill.`, s: base({ color: c.over, italic: true }) });

  return { name: 'Cost', rows, colWidths: [38, 24, ...Array.from({ length: Math.max(n + 1, 5) }, () => 15)], rowHeights, merges, showGrid: false, tabColor: c.accent };
}
