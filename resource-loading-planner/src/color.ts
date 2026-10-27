/** Small hex-colour helpers shared by the SVG renderer and the Excel writer. */
export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

/** t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white text, whichever reads better on `bg`. */
export const contrastText = (bg: string): string => (contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111827') ? '#ffffff' : '#111827');

/** Colour for text that flags a problem on `bg`: the alert colour itself on light rows, a lightened one on dark rows. */
export const alertOn = (alert: string, bg: string): string => (luminance(bg) > 0.35 ? alert : mix(alert, '#ffffff', 0.55));

/** `fg` if it is readable on `bg`, otherwise `fallback`. */
export const legible = (fg: string, bg: string, fallback: string): string => (contrastRatio(fg, bg) >= 3 ? fg : fallback);
