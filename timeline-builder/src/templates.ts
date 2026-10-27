import { DEFAULT_DESIGN, DEFAULT_STYLE, Project, ThemeDesign, TimelineStyle, clone, normalizeStyle } from './model';

export interface Template {
  id: string;
  name: string;
  /** The kind of design this layout is modelled on. */
  inspiredBy: string;
  /** The colour theme the template looks best with; applying the template switches the project to it. */
  themeId: string;
  style: TimelineStyle;
}

const tpl = (id: string, name: string, inspiredBy: string, style: Partial<Omit<TimelineStyle, 'design'>>, design: Partial<ThemeDesign>): Template => ({
  id, name, inspiredBy, themeId: id, style: { ...DEFAULT_STYLE, ...style, design: { ...DEFAULT_DESIGN, ...design } },
});

/** Layouts. Each one is paired with the colour theme of the same id, which is what it was designed with. */
export const TEMPLATES: Template[] = [
  tpl('corporate', 'Classic Grid', 'The standard ruled-grid Gantt chart', {}, {}),
  tpl('minimal', 'Minimal Outline', 'Clean line-art charts with outlined bars', { barRadius: 1, gridStyle: 'dashed' }, { header: 'underline', bar: 'outline', group: 'line', milestone: 'circle', gate: 'square' }),
  tpl('dark', 'Gradient Bars', 'Dark-mode project tools with gradient bars', {}, { bar: 'gradient', group: 'bar', milestone: 'star', gate: 'pentagon' }),
  tpl('pastel', 'Soft Pills', 'Friendly planner apps with rounded bars and headers', { barRadius: 9, rowHeight: 32 }, { header: 'rounded', bar: 'solid', group: 'bar', milestone: 'star', gate: 'flag' }),
  tpl('contrast', 'Striped Contrast', 'Accessible, print-friendly charts with striped bars', { barRadius: 0, rowHeight: 32 }, { bar: 'striped', gate: 'square' }),
  tpl('print', 'Print Lines', 'Black-and-white office documents', { zebra: false, gridStyle: 'dashed' }, { header: 'underline', bar: 'striped', group: 'line', milestone: 'diamond', gate: 'triangle' }),
  tpl('modern', 'Raised Bars', 'Modern SaaS roadmaps with shadowed bars', { barRadius: 7, rowHeight: 32, zebra: false }, { header: 'rounded', bar: 'shadow', group: 'bar', milestone: 'star', gate: 'check' }),
  tpl('blueprint', 'Blueprint Outline', 'Engineering drawings with outlined bars and dashed grid', { barRadius: 2, gridStyle: 'dashed' }, { header: 'solid', bar: 'outline', group: 'line', milestone: 'diamond', gate: 'flag' }),
  tpl('sunrise', 'Warm Gradient', 'Soft-gradient roadmap slides', { barRadius: 12, rowHeight: 34 }, { header: 'rounded', bar: 'gradient', group: 'bracket', milestone: 'flag', gate: 'pin' }),
  tpl('tpl-blue-modern', 'Dark Blue Pills', 'Slide-deck timelines with rounded row bands and a title banner', { barRadius: 20, rowHeight: 40, barHeight: 100, zebra: false, gridStyle: 'none' }, { header: 'solid', title: 'banner', frame: 'footer-band', rows: 'bands', progress: 'status', doneColor: '#3f97b0', labelHeading: 'Task List', group: 'bar', milestone: 'star', gate: 'diamond' }),
  tpl('tpl-blue-simple', 'Navy Process', 'Simple process charts with a banner and footer band', { barRadius: 0, rowHeight: 38, barHeight: 50, zebra: false, gridStyle: 'none' }, { header: 'solid', title: 'banner', frame: 'footer-band', rows: 'bands', labelHeading: 'Process', group: 'bar', milestone: 'diamond', gate: 'square' }),
  tpl('tpl-yellow-purple', 'Status Columns', 'Task lists with colour-coded status pills', { barRadius: 20, rowHeight: 38, barHeight: 62, zebra: false, gridStyle: 'none' }, { header: 'plain', title: 'split', titleColor: '#4a5fc1', frame: 'rule', rows: 'pillcols', group: 'heading', progress: 'none',
    labelHeading: 'Task List', statusColors: ['#f8d44c', '#e5602d', '#7c2bc8'], milestone: 'star', gate: 'diamond' }),
  tpl('tpl-orange-purple', 'Phase Pills Graph', 'Graph-style plans with vertical phase pills and guide lines', { barRadius: 20, rowHeight: 46, barHeight: 28, zebra: false, gridStyle: 'solid' }, { header: 'plain', title: 'plain', frame: 'rules', rows: 'itemline', progress: 'percent', groupLabel: 'side', doneColor: '#ee7f3c', highlight: '#86e3c5', labelHeading: 'Task List', group: 'bar', milestone: 'star', gate: 'flag' }),
  tpl('tpl-blue-purple-web', 'Gradient Web Roadmap', 'Web roadmaps with gradient bars on soft row bands', { barRadius: 20, rowHeight: 34, barHeight: 52, zebra: true, gridStyle: 'none' }, { header: 'plain', bar: 'gradient', gradientTo: '#e79bf5', title: 'plain', titleColor: '#2a46c8', subtitleColor: '#5b68b0', rows: 'bands-full', labelHeading: 'Task', group: 'bar', milestone: 'star', gate: 'pin' }),
  tpl('tpl-purple-yellow-web', 'Banded Process Table', 'Table-like process charts with coloured header groups', { barRadius: 20, rowHeight: 40, barHeight: 36, zebra: false, gridStyle: 'solid' }, { header: 'solid', title: 'center', titleColor: '#43299b', subtitleColor: '#d4a437', frame: 'thin-bands', rows: 'line', labelHeading: 'PROCESS',
    headerPalette: ['#d4a437', '#2a1783', '#6246b8'], group: 'bar', milestone: 'star', gate: 'hexagon' }),
  tpl('tpl-multi-overview', 'Cell Grid Overview', 'Overview grids where bars fill whole cells', { barRadius: 0, rowHeight: 34, barHeight: 100, zebra: false, gridStyle: 'dashed' }, { header: 'plain', title: 'center', titleColor: '#4338ca', cells: true, legend: 'boxes', labelHeading: '', group: 'bar', milestone: 'square', gate: 'diamond' }),
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find(t => t.id === id);

/** Apply a template's layout and its theme to a project. Items and timeline settings are left alone. */
export function applyTemplate(p: Project, t: Template): void {
  p.themeId = t.themeId;
  p.templateId = t.id;
  p.style = clone(t.style);
}

/**
 * Finds the layout of a project saved before themes and templates were separated: a custom design stored in the file
 * (or the browser library) wins, otherwise the built-in template that shares the old design's id.
 */
export function legacyMigration(rawCustomThemes: any[]): (themeId: string) => { style: any; templateId: string } | null {
  return themeId => {
    const custom = rawCustomThemes.find(t => t && typeof t === 'object' && t.id === themeId);
    if (custom) return { style: custom, templateId: '' };
    const t = templateById(themeId);
    return t ? { style: t.style, templateId: t.id } : null;
  };
}

export { normalizeStyle };
