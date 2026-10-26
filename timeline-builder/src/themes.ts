import type { Theme, ThemeDesign } from './model';
import { SHAPES, ShapeId } from './shapes';

const SANS = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

type Colors = Theme['colors'];
export const DEFAULT_DESIGN: ThemeDesign = {
  header: 'solid', bar: 'solid', group: 'bracket', milestone: 'diamond', gate: 'hexagon', note: 'circle',
  title: 'plain', frame: 'none', rows: 'grid', progress: 'overlay', groupLabel: 'row', cells: false, legend: 'inline',
  labelHeading: 'ACTIVITY', highlight: '', titleColor: '', subtitleColor: '', doneColor: '', gradientTo: '', statusColors: [], headerPalette: [],
};

const make = (id: string, name: string, colors: Colors, extra: Partial<Theme> = {}, design: Partial<ThemeDesign> = {}): Theme => ({
  id, name, builtin: true, colors, fontFamily: SANS, rowHeight: 30, barHeight: 60, barRadius: 4,
  gridStyle: 'solid', zebra: true, ...extra, design: { ...DEFAULT_DESIGN, ...design },
});

export const BUILTIN_THEMES: Theme[] = [
  make('corporate', 'Corporate Blue', {
    bg: '#ffffff', text: '#1f2937', subtext: '#6b7280', grid: '#e5e7eb', headerBg: '#1e3a5f', headerText: '#ffffff',
    headerBg2: '#2c5282', rowAlt: '#f5f8fc', weekend: '#eef1f5', holiday: '#ef4444', today: '#dc2626',
    task: '#3b82f6', group: '#1e3a5f', milestone: '#f59e0b', gate: '#10b981', holidayBand: '#fca5a5',
    note: '#6b7280', legendBg: '#f9fafb', border: '#d1d5db',
  }),
  make('minimal', 'Minimal Mono', {
    bg: '#ffffff', text: '#111111', subtext: '#777777', grid: '#e8e8e8', headerBg: '#ffffff', headerText: '#111111',
    headerBg2: '#f4f4f4', rowAlt: '#fafafa', weekend: '#f1f1f1', holiday: '#999999', today: '#111111',
    task: '#444444', group: '#111111', milestone: '#111111', gate: '#666666', holidayBand: '#cccccc',
    note: '#777777', legendBg: '#ffffff', border: '#cccccc',
  }, { barRadius: 1, gridStyle: 'dashed' }, { header: 'underline', bar: 'outline', group: 'line', milestone: 'circle', gate: 'square' }),
  make('dark', 'Midnight', {
    bg: '#0f172a', text: '#e2e8f0', subtext: '#94a3b8', grid: '#1e293b', headerBg: '#1e293b', headerText: '#f1f5f9',
    headerBg2: '#334155', rowAlt: '#131c31', weekend: '#16213a', holiday: '#f87171', today: '#fb7185',
    task: '#38bdf8', group: '#818cf8', milestone: '#fbbf24', gate: '#34d399', holidayBand: '#7f1d1d',
    note: '#94a3b8', legendBg: '#1e293b', border: '#334155',
  }, {}, { bar: 'gradient', group: 'bar', milestone: 'star', gate: 'pentagon' }),
  make('pastel', 'Pastel', {
    bg: '#fffdf9', text: '#4a4458', subtext: '#8b849b', grid: '#eee9f3', headerBg: '#c7b8ea', headerText: '#3b3354',
    headerBg2: '#ddd3f3', rowAlt: '#faf6fd', weekend: '#f3eef8', holiday: '#f4a6b7', today: '#e86a8a',
    task: '#8fc5e8', group: '#a592d8', milestone: '#f5c26b', gate: '#7fd1b0', holidayBand: '#f8cfd8',
    note: '#a39cb3', legendBg: '#faf6fd', border: '#e2dbec',
  }, { barRadius: 9, rowHeight: 32 }, { header: 'rounded', bar: 'solid', group: 'bar', milestone: 'star', gate: 'flag' }),
  make('contrast', 'High Contrast', {
    bg: '#ffffff', text: '#000000', subtext: '#333333', grid: '#999999', headerBg: '#000000', headerText: '#ffffff',
    headerBg2: '#222222', rowAlt: '#efefef', weekend: '#dddddd', holiday: '#d00000', today: '#d00000',
    task: '#0047ab', group: '#000000', milestone: '#e69500', gate: '#007a33', holidayBand: '#ff9999',
    note: '#333333', legendBg: '#ffffff', border: '#000000',
  }, { barRadius: 0, rowHeight: 32 }, { bar: 'striped', gate: 'square' }),
  make('print', 'Print B&W', {
    bg: '#ffffff', text: '#000000', subtext: '#555555', grid: '#cfcfcf', headerBg: '#e6e6e6', headerText: '#000000',
    headerBg2: '#f0f0f0', rowAlt: '#ffffff', weekend: '#ececec', holiday: '#777777', today: '#000000',
    task: '#7a7a7a', group: '#000000', milestone: '#000000', gate: '#4d4d4d', holidayBand: '#bdbdbd',
    note: '#555555', legendBg: '#ffffff', border: '#999999',
  }, { zebra: false, gridStyle: 'dashed' }, { header: 'underline', bar: 'striped', group: 'line', milestone: 'diamond', gate: 'triangle' }),
  make('modern', 'Modern Teal', {
    bg: '#ffffff', text: '#0f2a2e', subtext: '#5b7478', grid: '#e3eeee', headerBg: '#0f766e', headerText: '#ffffff',
    headerBg2: '#14b8a6', rowAlt: '#f4fbfa', weekend: '#edf5f4', holiday: '#e11d48', today: '#e11d48',
    task: '#0d9488', group: '#134e4a', milestone: '#f97316', gate: '#7c3aed', holidayBand: '#fda4af',
    note: '#64748b', legendBg: '#f4fbfa', border: '#cfe3e1',
  }, { barRadius: 7, rowHeight: 32, zebra: false }, { header: 'rounded', bar: 'shadow', group: 'bar', milestone: 'star', gate: 'check' }),
  make('blueprint', 'Blueprint', {
    bg: '#12355b', text: '#eaf3ff', subtext: '#a9c4e6', grid: '#2c5588', headerBg: '#0b2545', headerText: '#eaf3ff',
    headerBg2: '#1b4a7c', rowAlt: '#16406b', weekend: '#1a4577', holiday: '#ffd166', today: '#ff6b6b',
    task: '#8ecae6', group: '#ffffff', milestone: '#ffd166', gate: '#95e1a3', holidayBand: '#ffd166',
    note: '#a9c4e6', legendBg: '#0f2d4e', border: '#4a77ab',
  }, { barRadius: 2, gridStyle: 'dashed', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }, { header: 'solid', bar: 'outline', group: 'line', milestone: 'diamond', gate: 'flag' }),
  make('sunrise', 'Sunrise', {
    bg: '#fffaf5', text: '#3b2a20', subtext: '#8a6f5d', grid: '#f1e3d6', headerBg: '#c2410c', headerText: '#fff7ed',
    headerBg2: '#ea580c', rowAlt: '#fff3e8', weekend: '#fbeadb', holiday: '#be123c', today: '#be123c',
    task: '#f59e0b', group: '#9a3412', milestone: '#be123c', gate: '#15803d', holidayBand: '#fdba74',
    note: '#8a6f5d', legendBg: '#fff3e8', border: '#ecd5c0',
  }, { barRadius: 12, rowHeight: 34 }, { header: 'rounded', bar: 'gradient', group: 'bracket', milestone: 'flag', gate: 'pin' }),
  // ---- Template-style themes ----
  make('tpl-blue-modern', 'Template · Dark Blue Pills', {
    bg: '#14263d', text: '#e8f0fa', subtext: '#9db4d0', grid: '#1d3a5c', headerBg: '#17365d', headerText: '#ffffff',
    headerBg2: '#17365d', rowAlt: '#173150', weekend: '#193557', holiday: '#f87171', today: '#fbbf24',
    task: '#5f8bc9', group: '#3f97b0', milestone: '#fbbf24', gate: '#34d399', holidayBand: '#7f1d1d',
    note: '#9db4d0', legendBg: '#17365d', border: '#1d3a5c',
  }, { barRadius: 20, rowHeight: 40, barHeight: 100, zebra: false, gridStyle: 'none' },
  { header: 'solid', title: 'banner', frame: 'footer-band', rows: 'bands', progress: 'status', doneColor: '#3f97b0', labelHeading: 'Task List', group: 'bar', milestone: 'star', gate: 'diamond' }),
  make('tpl-blue-simple', 'Template · Navy Process', {
    bg: '#ffffff', text: '#111111', subtext: '#555555', grid: '#dddddd', headerBg: '#17365a', headerText: '#ffffff',
    headerBg2: '#a9c1e6', rowAlt: '#d9d9d9', weekend: '#eeeeee', holiday: '#c0392b', today: '#c0392b',
    task: '#17365a', group: '#17365a', milestone: '#17365a', gate: '#4a6fa5', holidayBand: '#e6b8b0',
    note: '#555555', legendBg: '#ffffff', border: '#17365a',
  }, { barRadius: 0, rowHeight: 38, barHeight: 50, zebra: false, gridStyle: 'none' },
  { header: 'solid', title: 'banner', frame: 'footer-band', rows: 'bands', labelHeading: 'Process', group: 'bar', milestone: 'diamond', gate: 'square' }),
  make('tpl-yellow-purple', 'Template · Status Columns', {
    bg: '#ffffff', text: '#111111', subtext: '#111111', grid: '#e8e8e8', headerBg: '#111111', headerText: '#111111',
    headerBg2: '#111111', rowAlt: '#f0f0f0', weekend: '#e7e7e7', holiday: '#e5602d', today: '#2f9bd8',
    task: '#7c2bc8', group: '#4a5fc1', milestone: '#e5602d', gate: '#7c2bc8', holidayBand: '#f8d44c',
    note: '#555555', legendBg: '#ffffff', border: '#b5b5b5',
  }, { barRadius: 20, rowHeight: 38, barHeight: 62, zebra: false, gridStyle: 'none' },
  { header: 'plain', title: 'split', titleColor: '#4a5fc1', frame: 'rule', rows: 'pillcols', group: 'heading', progress: 'none',
    labelHeading: 'Task List', statusColors: ['#f8d44c', '#e5602d', '#7c2bc8'], milestone: 'star', gate: 'diamond' }),
  make('tpl-orange-purple', 'Template · Orange & Purple Graph', {
    bg: '#ffffff', text: '#1a1a1a', subtext: '#555555', grid: '#c9c9c9', headerBg: '#ee7f3c', headerText: '#1a1a1a',
    headerBg2: '#ee7f3c', rowAlt: '#fdf7f3', weekend: '#f6f6f6', holiday: '#be185d', today: '#be185d',
    task: '#bf6fe0', group: '#bf6fe0', milestone: '#ee7f3c', gate: '#2f9e8f', holidayBand: '#fed7aa',
    note: '#555555', legendBg: '#ffffff', border: '#b5b5b5',
  }, { barRadius: 20, rowHeight: 46, barHeight: 28, zebra: false, gridStyle: 'solid' },
  { header: 'plain', title: 'plain', frame: 'rules', rows: 'itemline', progress: 'percent', groupLabel: 'side', doneColor: '#ee7f3c', highlight: '#86e3c5', labelHeading: 'Task List', group: 'bar', milestone: 'star', gate: 'flag' }),
  make('tpl-blue-purple-web', 'Template · Blue-Violet Gradient', {
    bg: '#ffffff', text: '#1f2a5c', subtext: '#5b68b0', grid: '#e6e9f8', headerBg: '#2a46c8', headerText: '#2a46c8',
    headerBg2: '#2a46c8', rowAlt: '#eef1fc', weekend: '#f1f3fc', holiday: '#ec4899', today: '#ec4899',
    task: '#3b5de7', group: '#2a46c8', milestone: '#a855f7', gate: '#06b6d4', holidayBand: '#f9a8d4',
    note: '#5b68b0', legendBg: '#ffffff', border: '#d6dbf3',
  }, { barRadius: 20, rowHeight: 34, barHeight: 52, zebra: true, gridStyle: 'none' },
  { header: 'plain', bar: 'gradient', gradientTo: '#e79bf5', title: 'plain', titleColor: '#2a46c8', subtitleColor: '#5b68b0', rows: 'bands-full', labelHeading: 'Task', group: 'bar', milestone: 'star', gate: 'pin' }),
  make('tpl-purple-yellow-web', 'Template · Purple & Gold Table', {
    bg: '#ffffff', text: '#43299b', subtext: '#d4a437', grid: '#e3c77a', headerBg: '#43299b', headerText: '#ffffff',
    headerBg2: '#6246b8', rowAlt: '#ffffff', weekend: '#f6efd9', holiday: '#e11d48', today: '#e11d48',
    task: '#43299b', group: '#2a1783', milestone: '#d4a437', gate: '#43299b', holidayBand: '#f4dfa0',
    note: '#7a6a96', legendBg: '#ffffff', border: '#d4a437',
  }, { barRadius: 20, rowHeight: 40, barHeight: 36, zebra: false, gridStyle: 'solid' },
  { header: 'solid', title: 'center', titleColor: '#43299b', subtitleColor: '#d4a437', frame: 'thin-bands', rows: 'line', labelHeading: 'PROCESS',
    headerPalette: ['#d4a437', '#2a1783', '#6246b8'], group: 'bar', milestone: 'star', gate: 'hexagon' }),
  make('tpl-multi-overview', 'Template · Cell Grid Overview', {
    bg: '#f6f4ef', text: '#111111', subtext: '#444444', grid: '#222222', headerBg: '#f6f4ef', headerText: '#111111',
    headerBg2: '#f6f4ef', rowAlt: '#f6f4ef', weekend: '#ece9e1', holiday: '#d03030', today: '#d03030',
    task: '#4338ca', group: '#72b157', milestone: '#f5bd62', gate: '#d03030', holidayBand: '#f5bd62',
    note: '#444444', legendBg: '#f6f4ef', border: '#222222',
  }, { barRadius: 0, rowHeight: 34, barHeight: 100, zebra: false, gridStyle: 'dashed', fontFamily: '"Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' },
  { header: 'plain', title: 'center', titleColor: '#4338ca', cells: true, legend: 'boxes', labelHeading: '', group: 'bar', milestone: 'square', gate: 'diamond' }),
];

export const THEME_COLOR_LABELS: Record<keyof Colors, string> = {
  bg: 'Background', text: 'Text', subtext: 'Secondary text', grid: 'Grid lines', headerBg: 'Header (top)',
  headerText: 'Header text', headerBg2: 'Header (columns)', rowAlt: 'Alternate row', weekend: 'Weekend shade',
  holiday: 'Public holiday', today: 'Today line', task: 'Task', group: 'Phase / group', milestone: 'Milestone',
  gate: 'Gate', holidayBand: 'Holiday band', note: 'Note', legendBg: 'Legend background', border: 'Borders',
};

const hex = (v: any): string => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '');
const pick = <T extends string>(v: any, allowed: T[], d: T): T => (allowed.includes(v) ? v : d);
const shapeOr = (v: any, d: ShapeId): ShapeId => (SHAPES.some(s => s.id === v) ? v : d);

export function validateTheme(raw: any): Theme | null {
  if (!raw || typeof raw !== 'object' || typeof raw.colors !== 'object') return null;
  const base = BUILTIN_THEMES[0];
  const colors: any = { ...base.colors };
  for (const k of Object.keys(colors)) if (/^#[0-9a-fA-F]{6}$/.test(raw.colors[k])) colors[k] = raw.colors[k];
  const num = (v: any, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || d));
  return {
    id: String(raw.id || ''), name: String(raw.name || 'Imported design'), colors,
    fontFamily: typeof raw.fontFamily === 'string' && raw.fontFamily ? raw.fontFamily : base.fontFamily,
    rowHeight: num(raw.rowHeight, 30, 20, 60), barHeight: num(raw.barHeight, 60, 20, 100),
    barRadius: num(raw.barRadius, 4, 0, 20),
    gridStyle: ['solid', 'dashed', 'none'].includes(raw.gridStyle) ? raw.gridStyle : 'solid',
    zebra: raw.zebra !== false,
    design: {
      ...DEFAULT_DESIGN,
      title: pick(raw.design?.title, ['plain', 'banner', 'center', 'split'], DEFAULT_DESIGN.title),
      frame: pick(raw.design?.frame, ['none', 'footer-band', 'thin-bands', 'rules', 'rule'], DEFAULT_DESIGN.frame),
      rows: pick(raw.design?.rows, ['grid', 'bands', 'bands-full', 'line', 'itemline', 'pillcols'], DEFAULT_DESIGN.rows),
      progress: pick(raw.design?.progress, ['overlay', 'percent', 'status', 'none'], DEFAULT_DESIGN.progress),
      groupLabel: pick(raw.design?.groupLabel, ['row', 'side'], DEFAULT_DESIGN.groupLabel),
      legend: pick(raw.design?.legend, ['inline', 'boxes'], DEFAULT_DESIGN.legend),
      cells: raw.design?.cells === true,
      labelHeading: typeof raw.design?.labelHeading === 'string' ? raw.design.labelHeading : DEFAULT_DESIGN.labelHeading,
      highlight: hex(raw.design?.highlight), titleColor: hex(raw.design?.titleColor), subtitleColor: hex(raw.design?.subtitleColor),
      doneColor: hex(raw.design?.doneColor), gradientTo: hex(raw.design?.gradientTo),
      statusColors: Array.isArray(raw.design?.statusColors) && raw.design.statusColors.length === 3 && raw.design.statusColors.every((c: any) => /^#[0-9a-fA-F]{6}$/.test(c)) ? raw.design.statusColors : [],
      headerPalette: (Array.isArray(raw.design?.headerPalette) ? raw.design.headerPalette : []).filter((c: any) => /^#[0-9a-fA-F]{6}$/.test(c)),
      header: ['solid', 'underline', 'rounded', 'plain'].includes(raw.design?.header) ? raw.design.header : DEFAULT_DESIGN.header,
      bar: ['solid', 'outline', 'gradient', 'striped', 'shadow'].includes(raw.design?.bar) ? raw.design.bar : DEFAULT_DESIGN.bar,
      group: ['bracket', 'bar', 'line', 'heading'].includes(raw.design?.group) ? raw.design.group : DEFAULT_DESIGN.group,
      milestone: shapeOr(raw.design?.milestone, DEFAULT_DESIGN.milestone),
      gate: shapeOr(raw.design?.gate, DEFAULT_DESIGN.gate),
      note: shapeOr(raw.design?.note, DEFAULT_DESIGN.note),
    },
  };
}
