import { describe, expect, it } from 'vitest';
import { addHoliday, duplicateDates, isValidDate, mergeHolidays, parseHolidayText, removeHoliday, sortHolidays, updateHoliday, weekdayName } from '../src/holidays';

const L = [{ date: '2026-12-25', name: 'Christmas' }, { date: '2026-01-26', name: 'Republic Day' }];

describe('holiday list editing (one holiday per row)', () => {
  it('validates real dates only', () => {
    expect(isValidDate('2026-03-02')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('26-03-02')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
  it('names the weekday', () => {
    expect(weekdayName('2026-03-02')).toBe('Mon');
    expect(weekdayName('2026-12-25')).toBe('Fri');
    expect(weekdayName('nope')).toBe('');
  });
  it('adds a holiday and keeps the list in date order', () => {
    const r = addHoliday(L, '2026-08-15', ' Independence Day ');
    expect(r.error).toBeUndefined();
    expect(r.list.map(h => h.date)).toEqual(['2026-01-26', '2026-08-15', '2026-12-25']);
    expect(r.list[1].name).toBe('Independence Day');
    expect(L).toHaveLength(2); // the original is not changed
  });
  it('a blank name becomes "Holiday"', () => {
    expect(addHoliday([], '2026-05-01', '   ').list[0].name).toBe('Holiday');
  });
  it('refuses a missing, invalid or repeated date, saying why', () => {
    expect(addHoliday(L, '', 'x').error).toMatch(/Pick a date/);
    expect(addHoliday(L, '2026-02-30', 'x').error).toMatch(/not a valid/);
    const dup = addHoliday(L, '2026-12-25', 'Again');
    expect(dup.error).toMatch(/already in the list \(Christmas\)/);
    expect(dup.list).toBe(L);
  });
  it('edits the name in place and the date with re-sorting', () => {
    const s = sortHolidays(L);
    const renamed = updateHoliday(s, 0, { name: 'Republic Day (India)' });
    expect(renamed.list[0]).toEqual({ date: '2026-01-26', name: 'Republic Day (India)' });
    const moved = updateHoliday(s, 0, { date: '2026-12-31' });
    expect(moved.list.map(h => h.date)).toEqual(['2026-12-25', '2026-12-31']);
    expect(moved.list[1].name).toBe('Republic Day');
  });
  it('refuses to move a holiday onto a date that is taken, or off the calendar', () => {
    const s = sortHolidays(L);
    expect(updateHoliday(s, 0, { date: '2026-12-25' }).error).toMatch(/already in the list/);
    expect(updateHoliday(s, 0, { date: '2026-02-31' }).error).toMatch(/not a valid/);
    expect(updateHoliday(s, 9, { name: 'x' }).error).toMatch(/no longer exists/);
    expect(updateHoliday(s, 0, { date: '2026-01-26' }).error).toBeUndefined(); // "changing" to the same date is fine
  });
  it('removes a row', () => {
    expect(removeHoliday(sortHolidays(L), 0).map(h => h.name)).toEqual(['Christmas']);
  });
  it('flags duplicates that older lists may contain', () => {
    expect([...duplicateDates([...L, { date: '2026-12-25', name: 'Again' }])]).toEqual(['2026-12-25']);
    expect(duplicateDates(L).size).toBe(0);
  });
  it('pasted text: valid lines are added, others counted, repeated dates skipped', () => {
    const p = parseHolidayText('2026-05-01, Labour Day\n2026-12-25 Xmas\nnot a date\n2026-02-30, Never\n\n2026-06-01');
    expect(p.holidays.map(h => h.date)).toEqual(['2026-05-01', '2026-12-25', '2026-06-01']);
    expect(p.bad).toBe(2);
    const m = mergeHolidays(L, p.holidays);
    expect(m).toMatchObject({ added: 2, skipped: 1 });
    expect(m.list.map(h => h.date)).toEqual(['2026-01-26', '2026-05-01', '2026-06-01', '2026-12-25']);
    expect(m.list.find(h => h.date === '2026-06-01')!.name).toBe('Holiday');
    expect(m.list.find(h => h.date === '2026-12-25')!.name).toBe('Christmas'); // the existing one wins
  });
});
