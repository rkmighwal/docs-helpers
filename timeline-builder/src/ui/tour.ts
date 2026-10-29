import { h } from './dom';

/** One stop of the guided tour. */
export interface TourStep {
  /** CSS selector of the thing to point at. Without one (or when it is not on screen) the step is a centred card. */
  target?: string;
  title: string;
  /** Plain text; a blank line starts a new paragraph. */
  body: string;
  /** Runs before the step is shown, e.g. to open the section it describes. */
  before?: () => void;
}

const MARGIN = 12;
const PAD = 6;

export const tourPending = (key: string): boolean => { try { return localStorage.getItem(key) !== 'done'; } catch { return false; } };
export const markTourDone = (key: string): void => { try { localStorage.setItem(key, 'done'); } catch { /* ignore */ } };

const onScreen = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0;

/**
 * A guided tour: the page is dimmed except for the thing being described, with a card next to it.
 * Next / Back / Skip, the arrow keys, Enter and Escape all work. `onClose(true)` when finished, `false` when skipped.
 */
export function startTour(steps: TourStep[], onClose: (finished: boolean) => void = () => {}): { stop: () => void } {
  let i = 0;
  let closed = false;
  const spot = h('div', { class: 'tour-spot' });
  const pop = h('div', { class: 'tour-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quick tour' });
  const root = h('div', { class: 'tour-root' }, h('div', { class: 'tour-shield' }), spot, pop);
  document.body.append(root);

  const finish = (done: boolean) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove, true);
    root.remove();
    onClose(done);
  };

  const go = (n: number) => {
    if (n >= steps.length) return finish(true);
    i = Math.max(0, n);
    steps[i].before?.();
    // let the page redraw (a section may have just been opened) before measuring
    requestAnimationFrame(() => requestAnimationFrame(() => { render(); place(true); }));
  };

  const render = () => {
    const s = steps[i], last = i === steps.length - 1;
    pop.replaceChildren(
      h('div', { class: 'tour-count' }, `${i + 1} of ${steps.length}`),
      h('h3', {}, s.title),
      ...s.body.split(/\n\s*\n/).map(t => h('p', {}, t.trim())),
      h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, ...steps.map((_, k) => h('span', { class: k === i ? 'on' : k < i ? 'seen' : '' }))),
      h('div', { class: 'tour-actions' },
        last ? h('span') : h('button', { class: 'linkbtn', onclick: () => finish(false) }, 'Skip tour'),
        h('span', { class: 'spacer' }),
        i > 0 ? h('button', { class: 'btn small', onclick: () => go(i - 1) }, '← Back') : null,
        h('button', { class: 'btn small primary', onclick: () => go(i + 1) }, last ? 'Finish' : 'Next →')));
    (pop.querySelector('.btn.primary') as HTMLElement | null)?.focus();
  };

  /** Put the spotlight on the step's target and the card beside it. */
  function place(scroll = false) {
    if (closed) return;
    const s = steps[i];
    const el = s.target ? document.querySelector(s.target) : null;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (onScreen(el)) {
      if (scroll) el.scrollIntoView({ block: el.getBoundingClientRect().height > vh * 0.8 ? 'start' : 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      // a target taller or wider than the window is highlighted as far as it is visible
      const x1 = Math.max(MARGIN / 2, r.left - PAD), y1 = Math.max(MARGIN / 2, r.top - PAD);
      const x2 = Math.min(vw - MARGIN / 2, r.right + PAD), y2 = Math.min(vh - MARGIN / 2, r.bottom + PAD);
      Object.assign(spot.style, { left: `${x1}px`, top: `${y1}px`, width: `${Math.max(0, x2 - x1)}px`, height: `${Math.max(0, y2 - y1)}px`, opacity: '1' });
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      const room = { right: vw - x2, left: x1, below: vh - y2, above: y1 };
      let left: number, top: number;
      if (room.right >= pw + MARGIN * 2) { left = x2 + MARGIN; top = y1; }
      else if (room.left >= pw + MARGIN * 2) { left = x1 - MARGIN - pw; top = y1; }
      else if (room.below >= ph + MARGIN * 2) { left = x1; top = y2 + MARGIN; }
      else if (room.above >= ph + MARGIN * 2) { left = x1; top = y1 - MARGIN - ph; }
      else { left = (vw - pw) / 2; top = vh - ph - MARGIN; } // no room beside it: dock at the bottom, over the dimmed part
      pop.style.left = `${Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - pw - MARGIN))}px`;
      pop.style.top = `${Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - ph - MARGIN))}px`;
    } else {
      // nothing to point at: dim everything and centre the card
      Object.assign(spot.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px', opacity: '1' });
      pop.style.left = `${Math.max(MARGIN, (vw - pop.offsetWidth) / 2)}px`;
      pop.style.top = `${Math.max(MARGIN, (vh - pop.offsetHeight) / 2)}px`;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      // Enter on a button should still press that button (Back, Skip)
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName === 'BUTTON' && !(e.target as HTMLElement).classList.contains('primary')) return;
      e.preventDefault(); e.stopPropagation(); go(i + 1);
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (i > 0) go(i - 1); }
  }
  function onMove() { place(); }
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onMove);
  window.addEventListener('scroll', onMove, true);
  go(0);
  return { stop: () => finish(false) };
}
