import { FILE_VERSION, HolidayList, Project, ProjectBundle, Theme, normalizeProject, uid } from './model';
import { Library, normalizeHolidayList } from './storage';
import { validateTheme } from './themes';
import { legacyMigration } from './templates';

export function download(filename: string, data: Blob | string | Uint8Array, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string): string => (s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'timeline');

export function makeBundle(p: Project, lib: Library): ProjectBundle {
  return {
    app: 'timeline-builder', version: FILE_VERSION, project: p,
    holidayLists: lib.holidayLists.filter(l => p.holidayListIds.includes(l.id)),
    customThemes: lib.customThemes.filter(t => t.id === p.themeId),
  };
}

/** Save with the native file picker where available, else a normal download. */
export async function saveJsonFile(filename: string, json: string): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const w: any = window;
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
      const ws = await h.createWritable();
      await ws.write(json); await ws.close();
      return 'saved';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  download(filename, json, 'application/json');
  return 'downloaded';
}

export function readFileText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

export interface ImportResult {
  projects: Project[];
  holidayLists: HolidayList[];
  themes: Theme[];
}

/** Accepts a single-project bundle, a full library backup, or a bare project. Throws on invalid input. */
export function parseImport(text: string): ImportResult {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
  const lists = (arr: any) => (Array.isArray(arr) ? arr : []).map(normalizeHolidayList);
  const themes = (arr: any) => (Array.isArray(arr) ? arr : []).map(validateTheme).filter(Boolean) as Theme[];
  // files written before themes and templates were separated keep the layout inside their custom designs
  const migrate = legacyMigration(Array.isArray(j?.customThemes) ? j.customThemes : []);
  const project = (p: any) => normalizeProject(p, migrate);
  if (Array.isArray(j?.projects)) {
    return { projects: j.projects.map(project), holidayLists: lists(j.holidayLists), themes: themes(j.customThemes) };
  }
  if (j?.project) return { projects: [project(j.project)], holidayLists: lists(j.holidayLists), themes: themes(j.customThemes) };
  if (Array.isArray(j?.items)) return { projects: [project(j)], holidayLists: [], themes: [] };
  throw new Error('This file does not look like a timeline project.');
}

/** Merge imported data into the library, giving new ids to anything that collides. */
export function mergeImport(lib: Library, r: ImportResult): Project[] {
  const idMap = new Map<string, string>();
  for (const l of r.holidayLists) {
    const existing = lib.holidayLists.find(x => x.id === l.id);
    if (existing && JSON.stringify(existing.holidays) === JSON.stringify(l.holidays)) continue;
    if (existing || !l.id) { const nid = uid(); idMap.set(l.id, nid); l.id = nid; }
    lib.holidayLists.push(l);
  }
  for (const t of r.themes) {
    if (!t.id || lib.customThemes.some(x => x.id === t.id)) {
      if (t.id && JSON.stringify(lib.customThemes.find(x => x.id === t.id)) === JSON.stringify(t)) continue;
      const nid = 'custom-' + uid(); idMap.set(t.id, nid); t.id = nid;
    }
    lib.customThemes.push(t);
  }
  for (const p of r.projects) {
    if (lib.projects.some(x => x.id === p.id)) p.id = uid();
    p.holidayListIds = p.holidayListIds.map(id => idMap.get(id) ?? id);
    if (idMap.has(p.themeId)) p.themeId = idMap.get(p.themeId)!;
    lib.projects.push(p);
  }
  return r.projects;
}

export function svgToPng(svg: string, w: number, h: number, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const g = c.getContext('2d')!;
      g.scale(scale, scale);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterise SVG')); };
    img.src = url;
  });
}
