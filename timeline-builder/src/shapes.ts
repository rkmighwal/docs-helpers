export type ShapeId = 'diamond' | 'circle' | 'square' | 'triangle' | 'star' | 'flag' | 'hexagon' | 'pentagon' | 'cross' | 'check' | 'pin';

export const SHAPES: { id: ShapeId; label: string }[] = [
  { id: 'diamond', label: 'Diamond' }, { id: 'circle', label: 'Circle' }, { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' }, { id: 'star', label: 'Star' }, { id: 'flag', label: 'Flag' },
  { id: 'hexagon', label: 'Hexagon' }, { id: 'pentagon', label: 'Pentagon' }, { id: 'cross', label: 'Cross / plus' },
  { id: 'check', label: 'Check mark' }, { id: 'pin', label: 'Target / pin' },
];

const poly = (pts: [number, number][], fill: string, stroke: string): string =>
  `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"/>`;

const ngon = (n: number, cx: number, cy: number, r: number, rot: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });

/** SVG markup for a marker shape of radius r centred on (cx, cy). `bg` is used for cut-outs. */
export function shapeSvg(id: ShapeId, cx: number, cy: number, r: number, fill: string, stroke: string, bg = '#ffffff'): string {
  switch (id) {
    case 'circle': return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
    case 'square': return `<rect x="${cx - r * 0.85}" y="${cy - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" rx="1.5" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
    case 'triangle': return poly([[cx, cy - r], [cx + r, cy + r * 0.8], [cx - r, cy + r * 0.8]], fill, stroke);
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 5, rr = i % 2 ? r * 0.45 : r * 1.1;
        pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
      return poly(pts, fill, stroke);
    }
    case 'flag':
      return `<line x1="${cx - r * 0.6}" y1="${cy - r}" x2="${cx - r * 0.6}" y2="${cy + r}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>` +
        poly([[cx - r * 0.6, cy - r], [cx + r, cy - r * 0.35], [cx - r * 0.6, cy + r * 0.3]], fill, stroke);
    case 'hexagon': return poly(ngon(6, cx, cy, r + 1, 0), fill, stroke);
    case 'pentagon': return poly(ngon(5, cx, cy + 0.5, r + 1, -Math.PI / 2), fill, stroke);
    case 'cross': {
      const a = r * 0.38, b = r;
      return poly([[cx - a, cy - b], [cx + a, cy - b], [cx + a, cy - a], [cx + b, cy - a], [cx + b, cy + a], [cx + a, cy + a], [cx + a, cy + b], [cx - a, cy + b], [cx - a, cy + a], [cx - b, cy + a], [cx - b, cy - a], [cx - a, cy - a]], fill, stroke);
    }
    case 'check':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
        `<polyline points="${cx - r * 0.5},${cy} ${cx - r * 0.12},${cy + r * 0.42} ${cx + r * 0.55},${cy - r * 0.38}" fill="none" stroke="${bg}" stroke-width="${Math.max(1.5, r * 0.28)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'pin':
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1"/><circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="${bg}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.28}" fill="${fill}"/>`;
    case 'diamond':
    default: return poly([[cx, cy - r * 1.1], [cx + r * 1.1, cy], [cx, cy + r * 1.1], [cx - r * 1.1, cy]], fill, stroke);
  }
}
