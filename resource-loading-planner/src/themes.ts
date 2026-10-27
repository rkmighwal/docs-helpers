import type { Theme, ThemeColors } from './model';

const SANS = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

const base: ThemeColors = {
  bg: '#ffffff', text: '#1f2937', subtext: '#6b7280', border: '#cbd5e1',
  headerBg: '#1e3a5f', headerText: '#ffffff', groupBg: '#e8eef7', groupText: '#1e3a5f', rowAlt: '#f8fafc',
  totalBg: '#1e3a5f', totalText: '#ffffff', accent: '#2563eb', heatLow: '#dbeafe', heatHigh: '#1d4ed8',
  over: '#dc2626', under: '#15803d', title: '#1e3a5f',
};

const make = (id: string, name: string, c: Partial<ThemeColors>, extra: Partial<Theme> = {}): Theme =>
  ({ id, name, builtin: true, colors: { ...base, ...c }, fontFamily: SANS, fontSize: 12, ...extra });

export const BUILTIN_THEMES: Theme[] = [
  make('classic', 'Classic Blue', {}),
  make('slate', 'Slate', {
    border: '#cbd5e1', headerBg: '#334155', groupBg: '#e2e8f0', groupText: '#1e293b', totalBg: '#334155', accent: '#475569', heatLow: '#e2e8f0', heatHigh: '#334155', title: '#1e293b',
  }),
  make('ocean', 'Ocean Teal', {
    border: '#c3dedb', headerBg: '#0f766e', groupBg: '#ccfbf1', groupText: '#134e4a', rowAlt: '#f4fbfa', totalBg: '#134e4a', accent: '#0d9488', heatLow: '#ccfbf1', heatHigh: '#0f766e', title: '#134e4a',
  }),
  make('forest', 'Forest', {
    border: '#c9dccd', headerBg: '#166534', groupBg: '#dcfce7', groupText: '#14532d', rowAlt: '#f6fbf7', totalBg: '#14532d', accent: '#16a34a', heatLow: '#dcfce7', heatHigh: '#15803d', title: '#14532d',
  }),
  make('sunset', 'Sunset', {
    bg: '#fffaf5', text: '#3b2a20', subtext: '#8a6f5d', border: '#ecd5c0', headerBg: '#c2410c', headerText: '#fff7ed', groupBg: '#ffedd5', groupText: '#7c2d12',
    rowAlt: '#fff3e8', totalBg: '#7c2d12', accent: '#ea580c', heatLow: '#ffedd5', heatHigh: '#ea580c', title: '#9a3412',
  }),
  make('grape', 'Grape', {
    border: '#ddd6f3', headerBg: '#6d28d9', groupBg: '#ede9fe', groupText: '#4c1d95', rowAlt: '#faf8ff', totalBg: '#4c1d95', accent: '#7c3aed', heatLow: '#ede9fe', heatHigh: '#7c3aed', title: '#4c1d95',
  }),
  make('pastel', 'Pastel', {
    bg: '#fffdf9', text: '#4a4458', subtext: '#8b849b', border: '#e2dbec', headerBg: '#c7b8ea', headerText: '#3b3354', groupBg: '#ede7f9', groupText: '#4a4458',
    rowAlt: '#faf6fd', totalBg: '#ddd3f3', totalText: '#3b3354', accent: '#8fc5e8', heatLow: '#e8f3fb', heatHigh: '#8fc5e8', over: '#e86a8a', under: '#4aa987', title: '#5b4a8c',
  }),
  make('midnight', 'Midnight (dark)', {
    bg: '#0f172a', text: '#e2e8f0', subtext: '#94a3b8', border: '#334155', headerBg: '#1e293b', headerText: '#f1f5f9', groupBg: '#1e293b', groupText: '#e2e8f0',
    rowAlt: '#131c31', totalBg: '#334155', totalText: '#ffffff', accent: '#38bdf8', heatLow: '#12304a', heatHigh: '#38bdf8', over: '#f87171', under: '#34d399', title: '#f1f5f9',
  }),
  make('mono', 'Print B&W', {
    text: '#000000', subtext: '#555555', border: '#8a8a8a', headerBg: '#e6e6e6', headerText: '#000000', groupBg: '#f0f0f0', groupText: '#000000', rowAlt: '#f7f7f7',
    totalBg: '#d4d4d4', totalText: '#000000', accent: '#555555', heatLow: '#eeeeee', heatHigh: '#555555', over: '#000000', under: '#000000', title: '#000000',
  }),
  // ---- themes that go with the templates ----
  make('sheet', 'Spreadsheet Grey', {
    border: '#c6c6c6', headerBg: '#e8e8e8', headerText: '#1f1f1f', groupBg: '#dde5f0', groupText: '#1f1f1f', rowAlt: '#f7f7f7',
    totalBg: '#d9d9d9', totalText: '#000000', accent: '#217346', heatLow: '#e2efda', heatHigh: '#548235', over: '#c00000', under: '#217346', title: '#217346',
  }, { fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif', fontSize: 12 }),
  make('gsheet', 'Clean Sheet', {
    border: '#dadce0', headerBg: '#f8f9fa', headerText: '#202124', groupBg: '#e8f0fe', groupText: '#174ea6', rowAlt: '#fafafa',
    totalBg: '#f1f3f4', totalText: '#202124', accent: '#1a73e8', heatLow: '#e8f0fe', heatHigh: '#1a73e8', over: '#d93025', under: '#188038', title: '#202124',
  }, { fontFamily: 'Roboto, Arial, sans-serif' }),
  make('notion', 'Soft Notes', {
    text: '#37352f', subtext: '#9b9a97', border: '#e9e9e7', headerBg: '#ffffff', headerText: '#787774', groupBg: '#f7f6f3', groupText: '#37352f', rowAlt: '#fbfbfa',
    totalBg: '#f1f1ef', totalText: '#37352f', accent: '#2383e2', heatLow: '#e7f3f8', heatHigh: '#2383e2', over: '#eb5757', under: '#4d9a7d', title: '#37352f',
  }, { fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' }),
  make('bootstrap', 'Dark Header Stripes', {
    border: '#dee2e6', headerBg: '#212529', headerText: '#ffffff', groupBg: '#e9ecef', groupText: '#212529', rowAlt: '#f2f2f2',
    totalBg: '#212529', totalText: '#ffffff', accent: '#0d6efd', heatLow: '#cfe2ff', heatHigh: '#0d6efd', over: '#dc3545', under: '#198754', title: '#212529',
  }),
  make('material', 'Material Light', {
    text: '#212121', subtext: '#757575', border: '#e0e0e0', headerBg: '#ffffff', headerText: '#616161', groupBg: '#f5f5f5', groupText: '#212121', rowAlt: '#fafafa',
    totalBg: '#ede7f6', totalText: '#311b92', accent: '#6200ee', heatLow: '#ede7f6', heatHigh: '#6200ee', over: '#b00020', under: '#2e7d32', title: '#212121',
  }, { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' }),
  make('github', 'Docs Light', {
    text: '#1f2328', subtext: '#656d76', border: '#d0d7de', headerBg: '#f6f8fa', headerText: '#1f2328', groupBg: '#ddf4ff', groupText: '#0550ae', rowAlt: '#f6f8fa',
    totalBg: '#f6f8fa', totalText: '#1f2328', accent: '#0969da', heatLow: '#ddf4ff', heatHigh: '#0969da', over: '#cf222e', under: '#1a7f37', title: '#1f2328',
  }),
  make('heatwave', 'Indigo Heat', {
    border: '#ffffff', headerBg: '#ffffff', headerText: '#475569', groupBg: '#eef2ff', groupText: '#3730a3', rowAlt: '#ffffff',
    totalBg: '#e0e7ff', totalText: '#312e81', accent: '#6366f1', heatLow: '#e0f2fe', heatHigh: '#6366f1', over: '#e11d48', under: '#059669', title: '#312e81',
  }),
  make('consulting', 'Navy & Gold', {
    border: '#d6dbe4', headerBg: '#0b2545', headerText: '#ffffff', groupBg: '#eef2f7', groupText: '#0b2545', rowAlt: '#f8f9fb',
    totalBg: '#0b2545', totalText: '#f5d77a', accent: '#c8a24a', heatLow: '#fdf3d6', heatHigh: '#b8860b', over: '#b91c1c', under: '#15803d', title: '#0b2545',
  }, { fontFamily: 'Georgia, "Times New Roman", serif' }),
  make('dashboard', 'Dark Dashboard', {
    bg: '#111217', text: '#d8d9da', subtext: '#8e8e93', border: '#2c3235', headerBg: '#181b1f', headerText: '#d8d9da', groupBg: '#202226', groupText: '#f2f2f3',
    rowAlt: '#14161a', totalBg: '#2c3235', totalText: '#ffffff', accent: '#ff9830', heatLow: '#3a2a12', heatHigh: '#ff9830', over: '#f2495c', under: '#73bf69', title: '#ffffff',
  }, { fontFamily: `Inter, ${SANS}` }),
  make('terminal', 'Blueprint Mono', {
    bg: '#12355b', text: '#eaf3ff', subtext: '#a9c4e6', border: '#2c5588', headerBg: '#0b2545', headerText: '#eaf3ff', groupBg: '#1b4a7c', groupText: '#ffffff',
    rowAlt: '#16406b', totalBg: '#0b2545', totalText: '#ffd166', accent: '#8ecae6', heatLow: '#1b4a7c', heatHigh: '#8ecae6', over: '#ff6b6b', under: '#95e1a3', title: '#ffffff',
  }, { fontFamily: MONO }),
];

export const THEME_COLOR_LABELS: Record<keyof ThemeColors, string> = {
  bg: 'Background', text: 'Text', subtext: 'Secondary text', border: 'Borders', headerBg: 'Header', headerText: 'Header text',
  groupBg: 'Group rows', groupText: 'Group text', rowAlt: 'Alternate rows', totalBg: 'Total row', totalText: 'Total text',
  accent: 'Accent / bars', heatLow: 'Heat map: low', heatHigh: 'Heat map: high', over: 'Over-allocated', under: 'Spare capacity', title: 'Title',
};

export function validateTheme(raw: any): Theme | null {
  if (!raw || typeof raw !== 'object' || typeof raw.colors !== 'object' || !raw.colors) return null;
  const colors: ThemeColors = { ...base };
  for (const k of Object.keys(colors) as (keyof ThemeColors)[]) if (/^#[0-9a-fA-F]{6}$/.test(raw.colors[k])) colors[k] = raw.colors[k];
  const size = Number(raw.fontSize);
  return {
    id: String(raw.id || ''), name: String(raw.name || 'Imported theme'), colors,
    fontFamily: typeof raw.fontFamily === 'string' && raw.fontFamily ? raw.fontFamily : SANS,
    fontSize: Number.isFinite(size) ? Math.min(20, Math.max(9, size)) : 12,
  };
}

export const themeById = (id: string, custom: Theme[]): Theme => [...BUILTIN_THEMES, ...custom].find(t => t.id === id) ?? BUILTIN_THEMES[0];
