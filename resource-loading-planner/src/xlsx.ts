/**
 * A small, dependency-free .xlsx writer: styled cells, merged ranges, frozen panes, column widths and
 * date formats. The package is a ZIP written without compression, which every spreadsheet app accepts.
 */

export interface XBorder { style: 'thin' | 'medium' | 'dashed' | 'dotted' | 'double'; color: string }
export interface XStyle {
  bold?: boolean; italic?: boolean; color?: string; size?: number; font?: string;
  fill?: string;
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'center' | 'bottom'; wrap?: boolean; indent?: number;
  border?: { l?: XBorder; r?: XBorder; t?: XBorder; b?: XBorder };
  numFmt?: string;
}
/** `f` is a formula (without the leading =); `v` is then the value shown until the spreadsheet recalculates. */
export interface XCell { v?: string | number | null; s?: XStyle; f?: string }
export interface XSheet {
  name: string;
  rows: (XCell | undefined)[][];
  colWidths?: number[];
  rowHeights?: Record<number, number>;
  merges?: string[];
  /** Number of rows / columns kept in view while scrolling. */
  freeze?: { rows: number; cols: number };
  autoFilter?: string;
  showGrid?: boolean;
  tabColor?: string;
  landscape?: boolean;
}

const enc = new TextEncoder();
const xml = (s: string): string => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const argb = (hex: string): string => 'FF' + hex.replace('#', '').toUpperCase();

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const cellRef = (r: number, c: number): string => `${colName(c)}${r + 1}`;
export const rangeRef = (r1: number, c1: number, r2: number, c2: number): string => `${cellRef(r1, c1)}:${cellRef(r2, c2)}`;

/** Excel serial number of an ISO date (1900 date system). */
export const excelDate = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5) + 25569;
};

/* ---------------- ZIP (stored) ---------------- */

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[], now = new Date()): Uint8Array {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/* ---------------- styles ---------------- */

class StyleBook {
  private fonts: string[] = [];
  private fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private numFmts: string[] = [];
  private xfs: string[] = [];
  private cache = new Map<string, number>();

  constructor() {
    this.fonts.push(this.fontXml({}));
    this.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
  }

  private fontXml(s: XStyle): string {
    return `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size ?? 11}"/><color rgb="${argb(s.color ?? '#000000')}"/><name val="${xml(s.font ?? 'Calibri')}"/><family val="2"/></font>`;
  }
  private side(tag: string, b?: XBorder): string {
    return b ? `<${tag} style="${b.style}"><color rgb="${argb(b.color)}"/></${tag}>` : `<${tag}/>`;
  }
  private intern(list: string[], x: string): number {
    const i = list.indexOf(x);
    if (i >= 0) return i;
    list.push(x);
    return list.length - 1;
  }

  index(s?: XStyle): number {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const font = this.intern(this.fonts, this.fontXml(s));
    const fill = s.fill ? this.intern(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const b = s.border;
    const border = b ? this.intern(this.borders, `<border>${this.side('left', b.l)}${this.side('right', b.r)}${this.side('top', b.t)}${this.side('bottom', b.b)}<diagonal/></border>`) : 0;
    let numFmtId = 0;
    if (s.numFmt) {
      const i = this.numFmts.indexOf(s.numFmt);
      numFmtId = 164 + (i >= 0 ? i : this.numFmts.push(s.numFmt) - 1);
    }
    const align = s.align || s.valign || s.wrap || s.indent
      ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''} vertical="${s.valign ?? 'center'}"${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>` : '';
    const xf = `<xf numFmtId="${numFmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''} applyFont="1"${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`;
    this.xfs.push(xf);
    const idx = this.xfs.length - 1;
    this.cache.set(key, idx);
    return idx;
  }

  xml(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(f)}"/>`).join('')}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
}

/* ---------------- workbook ---------------- */

const safeSheetName = (n: string, used: Set<string>): string => {
  let base = n.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) name = base.slice(0, 31 - String(i).length - 1) + ' ' + i++;
  used.add(name.toLowerCase());
  return name;
};

function sheetXml(sh: XSheet, book: StyleBook): string {
  const rows = sh.rows;
  const maxC = rows.reduce((m, r) => Math.max(m, r.length), 0);
  let sd = '';
  rows.forEach((row, ri) => {
    const ht = sh.rowHeights?.[ri];
    let cells = '';
    row.forEach((c, ci) => {
      if (!c || (c.v === undefined && !c.s && !c.f)) return;
      const ref = cellRef(ri, ci), s = book.index(c.s), sAttr = s ? ` s="${s}"` : '';
      if (c.f) cells += `<c r="${ref}"${sAttr}><f>${xml(c.f)}</f><v>${typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : 0}</v></c>`;
      else if (c.v === undefined || c.v === null || c.v === '') cells += `<c r="${ref}"${sAttr}/>`;
      else if (typeof c.v === 'number') cells += `<c r="${ref}"${sAttr}><v>${Number.isFinite(c.v) ? c.v : 0}</v></c>`;
      else cells += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
    });
    if (cells || ht) sd += `<row r="${ri + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
  });
  const fr = sh.freeze;
  const pane = fr && (fr.rows || fr.cols)
    ? `<pane${fr.cols ? ` xSplit="${fr.cols}"` : ''}${fr.rows ? ` ySplit="${fr.rows}"` : ''} topLeftCell="${cellRef(fr.rows, fr.cols)}" activePane="${fr.rows && fr.cols ? 'bottomRight' : fr.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
  const cols = sh.colWidths?.length ? `<cols>${sh.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetPr>${sh.tabColor ? `<tabColor rgb="${argb(sh.tabColor)}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${cellRef(Math.max(0, rows.length - 1), Math.max(0, maxC - 1))}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${sh.showGrid === false ? ' showGridLines="0"' : ''}>${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' + cols +
    `<sheetData>${sd}</sheetData>` +
    (sh.autoFilter ? `<autoFilter ref="${sh.autoFilter}"/>` : '') +
    (sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    `<pageSetup orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
    '</worksheet>';
}

export function buildXlsx(sheets: XSheet[], now = new Date()): Uint8Array {
  const book = new StyleBook();
  const used = new Set<string>();
  const names = sheets.map(s => safeSheetName(s.name, used));
  const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s, book)) }));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode(head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc.encode(head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' +
      names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    ...sheetFiles,
    { name: 'xl/styles.xml', data: enc.encode(book.xml()) }, // last: styles are collected while the sheets are written
  ];
  return zipStore(files, now);
}
