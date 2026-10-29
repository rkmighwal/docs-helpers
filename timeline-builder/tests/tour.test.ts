import { describe, expect, it } from 'vitest';
import { TOUR_CARDS, timelineTour } from '../src/tourSteps';

describe('quick tour', () => {
  const opened: string[] = [];
  const steps = timelineTour({ showCard: id => opened.push(id) });
  it('starts and ends with a centred card and has a title and text for every step', () => {
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps[0].target).toBeUndefined();
    expect(steps[steps.length - 1].target).toBeUndefined();
    for (const s of steps) { expect(s.title.trim().length).toBeGreaterThan(2); expect(s.body.trim().length).toBeGreaterThan(20); }
  });
  it('points at distinct things', () => {
    const targets = steps.map(s => s.target).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });
  it('opens exactly the sections it describes, all of which exist', () => {
    for (const s of steps) s.before?.();
    expect(new Set(opened)).toEqual(new Set(TOUR_CARDS));
    for (const s of steps.filter(x => x.target?.startsWith('[data-card'))) expect(s.before).toBeTypeOf('function');
  });
});
