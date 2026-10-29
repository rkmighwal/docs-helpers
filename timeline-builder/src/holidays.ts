import { DOW, parse } from './dates';

export interface Holiday { date: string; name: string }

export const DEFAULT_HOLIDAY_NAME = 'Holiday';

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parse(s);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The weekday of a date as Mon, Tue… ('' for something that is not a date). */
export const weekdayName = (iso: string): string => (isValidDate(iso) ? DOW[parse(iso).getUTCDay()] : '');

/** Parse lines like `2026-01-26, Republic Day` (comma, semicolon, tab or space between date and name). */
export function parseHolidayText(text: string): { holidays: Holiday[]; bad: number } {
  const holidays: Holiday[] = [];
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*[,;\t ]?\s*(.*)$/);
    if (m && isValidDate(m[1])) holidays.push({ date: m[1], name: m[2].replace(/^"|"$/g, '').trim() });
    else bad++;
  }
  return { holidays, bad };
}

export const sortHolidays = (list: Holiday[]): Holiday[] => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

/** Dates that appear more than once (only the first holiday on a date is used by the planner). */
export function duplicateDates(list: Holiday[]): Set<string> {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const h of list) (seen.has(h.date) ? dup : seen).add(h.date);
  return dup;
}

export type Edit = { list: Holiday[]; error?: undefined } | { list: Holiday[]; error: string };

/** Add one holiday. A blank name becomes "Holiday". Refuses a missing / invalid date and a date already in the list. */
export function addHoliday(list: Holiday[], date: string, name: string): Edit {
  if (!date) return { list, error: 'Pick a date first.' };
  if (!isValidDate(date)) return { list, error: 'That is not a valid date.' };
  const clash = list.find(h => h.date === date);
  if (clash) return { list, error: `${date} is already in the list${clash.name ? ` (${clash.name})` : ''}.` };
  return { list: sortHolidays([...list, { date, name: name.trim() || DEFAULT_HOLIDAY_NAME }]) };
}

/** Change the date and/or the name of the holiday at `index`. A date change is refused if another holiday is on that date. */
export function updateHoliday(list: Holiday[], index: number, patch: Partial<Holiday>): Edit {
  const cur = list[index];
  if (!cur) return { list, error: 'That holiday no longer exists.' };
  const next = { ...cur, ...patch };
  if (patch.date !== undefined && patch.date !== cur.date) {
    if (!isValidDate(next.date)) return { list, error: 'That is not a valid date.' };
    const clash = list.find((h, i) => i !== index && h.date === next.date);
    if (clash) return { list, error: `${next.date} is already in the list${clash.name ? ` (${clash.name})` : ''}.` };
  }
  const out = list.slice(); out[index] = { date: next.date, name: next.name };
  return { list: patch.date !== undefined ? sortHolidays(out) : out };
}

export const removeHoliday = (list: Holiday[], index: number): Holiday[] => list.filter((_, i) => i !== index);

/** Add many at once (pasted text, a file), skipping dates that are already there. */
export function mergeHolidays(list: Holiday[], incoming: Holiday[]): { list: Holiday[]; added: number; skipped: number } {
  const have = new Set(list.map(h => h.date));
  const out = [...list];
  let added = 0, skipped = 0;
  for (const h of incoming) {
    if (have.has(h.date)) { skipped++; continue; }
    have.add(h.date); out.push({ date: h.date, name: h.name.trim() || DEFAULT_HOLIDAY_NAME }); added++;
  }
  return { list: sortHolidays(out), added, skipped };
}
