import { DEFAULT_STYLE, Project, TableStyle, ViewOptions, clone, normalizeStyle } from './model';

export interface Template {
  id: string;
  name: string;
  /** The familiar design this template takes its look from. */
  inspiredBy: string;
  themeId: string;
  style: Partial<Omit<TableStyle, 'borders'>> & { borders?: Partial<TableStyle['borders']> };
  view?: Partial<ViewOptions>;
}

const none = { outer: false, header: false, rows: false, cols: false, labels: false, groups: false, total: false };

export const TEMPLATES: Template[] = [
  {
    id: 'spreadsheet', name: 'Spreadsheet Grid', inspiredBy: 'Excel worksheets', themeId: 'sheet',
    style: { header: 'solid', group: 'tint', cell: 'number', density: 'compact', align: 'center', zebra: false },
  },
  {
    id: 'clean-sheet', name: 'Clean Sheet', inspiredBy: 'Online spreadsheets (light grid, blue accents)', themeId: 'gsheet',
    style: { header: 'solid', group: 'tint', cell: 'number', density: 'normal', borderWidth: 1 },
  },
  {
    id: 'minimal-rows', name: 'Minimal Rows', inspiredBy: 'Note-taking app tables (horizontal rules only)', themeId: 'notion',
    style: { borders: { ...none, header: true, rows: true }, header: 'plain', group: 'bold', cell: 'number', density: 'roomy', align: 'center' },
    view: { showTitle: true },
  },
  {
    id: 'striped', name: 'Striped Table', inspiredBy: 'Bootstrap striped tables', themeId: 'bootstrap',
    style: { borders: { ...none, header: true, rows: true, total: true, groups: true }, header: 'solid', group: 'band', zebra: true, cell: 'number', density: 'normal' },
  },
  {
    id: 'material', name: 'Material Data Table', inspiredBy: 'Material Design data tables', themeId: 'material',
    style: { borders: { ...none, outer: true, header: true, rows: true, total: true }, header: 'plain', group: 'tint', cell: 'number', density: 'roomy', align: 'right', radius: 8 },
  },
  {
    id: 'docs-table', name: 'Docs Table', inspiredBy: 'GitHub / documentation tables', themeId: 'github',
    style: { borders: { ...none, outer: true, header: true, rows: true, cols: true, labels: true, total: true }, header: 'solid', group: 'tint', zebra: true, cell: 'number', density: 'normal', radius: 6 },
  },
  {
    id: 'heatmap', name: 'Resource Heatmap', inspiredBy: 'Resource-planning tools with utilisation heat maps', themeId: 'heatwave',
    style: { borders: { ...none, rows: true, cols: true, labels: true }, borderWidth: 2, header: 'plain', group: 'tint', cell: 'heat', density: 'normal', radius: 4, zebra: false },
    view: { showCapacity: true, showGap: true },
  },
  {
    id: 'data-bars', name: 'Capacity Bars', inspiredBy: 'Work-management dashboards with in-cell bars', themeId: 'classic',
    style: { borders: { ...none, header: true, rows: true, total: true, groups: true }, header: 'solid', group: 'band', cell: 'bar', density: 'normal', align: 'center' },
  },
  {
    id: 'chips', name: 'Work-stream Chips', inspiredBy: 'Board / project-tracker pill labels', themeId: 'pastel',
    style: { borders: { ...none, header: true, rows: true }, header: 'solid', group: 'tint', cell: 'chip', density: 'roomy', radius: 6 },
  },
  {
    id: 'gantt-fill', name: 'Gantt Fill', inspiredBy: 'Gantt tools that colour whole cells', themeId: 'classic',
    style: { borders: { ...none, outer: true, header: true, rows: true, cols: true, labels: true, total: true }, borderWidth: 1, header: 'solid', group: 'tint', cell: 'fill', density: 'normal' },
  },
  {
    id: 'consulting', name: 'Consulting Navy', inspiredBy: 'Management-consulting slide tables', themeId: 'consulting',
    style: { borders: { ...none, outer: true, header: true, groups: true, total: true, labels: true }, header: 'solid', group: 'band', cell: 'number', density: 'normal', title: 'banner' },
  },
  {
    id: 'dashboard', name: 'Dark Dashboard', inspiredBy: 'Monitoring dashboards in dark mode', themeId: 'dashboard',
    style: { borders: { ...none, outer: true, header: true, rows: true, total: true }, header: 'solid', group: 'band', cell: 'heat', density: 'normal', radius: 6 },
  },
  {
    id: 'print-bw', name: 'Print B&W', inspiredBy: 'Black-and-white office documents', themeId: 'mono',
    style: { header: 'solid', group: 'bold', cell: 'number', density: 'normal', zebra: false, borderWidth: 1 },
  },
];

/** Apply a template's theme and table style to a project. Content (rows, columns shown, grouping) is left alone, apart from what the template lists in `view`. */
export function applyTemplate(p: Project, t: Template): void {
  p.themeId = t.themeId;
  p.templateId = t.id;
  const s = clone(DEFAULT_STYLE);
  p.style = normalizeStyle({ ...s, ...t.style, borders: { ...s.borders, ...(t.style.borders ?? {}) } });
  if (t.view) p.view = { ...p.view, ...t.view };
}
