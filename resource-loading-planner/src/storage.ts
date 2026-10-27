import { HolidayList, Project, Theme, normalizeProject, sampleProject } from './model';
import { validateTheme } from './themes';

const KEY = 'resource-loading-planner:v1';

export interface Library {
  projects: Project[];
  holidayLists: HolidayList[];
  customThemes: Theme[];
  activeId: string;
}

export function normalizeHolidayList(raw: any): HolidayList {
  const holidays = (Array.isArray(raw?.holidays) ? raw.holidays : [])
    .filter((h: any) => /^\d{4}-\d{2}-\d{2}$/.test(h?.date))
    .map((h: any) => ({ date: h.date, name: String(h.name ?? '') }));
  return { id: String(raw?.id || ''), name: String(raw?.name || 'Holidays'), holidays };
}

export function freshLibrary(): Library {
  const p = sampleProject();
  return { projects: [p], holidayLists: [], customThemes: [], activeId: p.id };
}

/** Parse a stored or imported library; anything unusable is dropped rather than thrown. */
export function parseLibrary(j: any): Library {
  const projects = (Array.isArray(j?.projects) ? j.projects : []).map(normalizeProject);
  if (!projects.length) return freshLibrary();
  return {
    projects,
    holidayLists: (Array.isArray(j?.holidayLists) ? j.holidayLists : []).map(normalizeHolidayList),
    customThemes: (Array.isArray(j?.customThemes) ? j.customThemes : []).map(validateTheme).filter(Boolean) as Theme[],
    activeId: projects.some((p: Project) => p.id === j.activeId) ? j.activeId : projects[0].id,
  };
}

export function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseLibrary(JSON.parse(raw)) : freshLibrary();
  } catch {
    return freshLibrary();
  }
}

/** Returns true on success. */
export function saveLibrary(lib: Library): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}
