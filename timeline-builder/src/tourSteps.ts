import type { TourStep } from './ui/tour';

export interface TourApi {
  /** Open one editor section (and fold the others) so the step can describe what is inside it. */
  showCard: (id: string) => void;
}

/** The sections the tour opens. */
export const TOUR_CARDS = ['timeline', 'items', 'look', 'layout'] as const;

export function timelineTour(api: TourApi): TourStep[] {
  const card = (id: (typeof TOUR_CARDS)[number], title: string, body: string): TourStep => ({ target: `[data-card="${id}"]`, title, body, before: () => api.showCard(id) });
  return [
    {
      title: 'Welcome to Timeline Builder',
      body: 'Build a project timeline (Gantt-style) with tasks, phases, milestones and holidays, and export it as SVG or PNG for slides and documents.\n\nThis one-minute tour shows where everything is. Use the Next button, the arrow keys, or Esc to skip. You can replay it any time from “Quick tour” in the top bar.',
    },
    { target: '.side', title: 'Your projects', body: 'Every timeline is a project. Add, copy, reorder or delete them here. Projects save automatically in this browser; use File ▸ Save project as JSON to keep a file you can import later or share.' },
    card('timeline', '1 · Set up the timeline', 'Choose what one column is (a week, month, quarter or year) and group the columns under months, quarters or years. Use real dates with a start date, or “no dates” for Week 0, Week 1…\n\nTick the working days of the week and attach holiday lists: end dates and working days are calculated from each other, skipping the days that do not count.'),
    card('items', '2 · Add the items', 'Add tasks, phases, milestones, gates, holiday bands and notes. Edit either the end date or the working days and the other follows. Drag ⠿ to reorder (a phase takes its tasks with it) and use ⋯ for colours, icons and progress.'),
    { target: '.preview-scroll', title: 'The live preview', body: 'This is exactly what you will export. Drag a bar to move it, drag its left or right edge to resize it, and use Fit width and the zoom slider to get a good view.' },
    { target: '[data-tour="templates"]', title: 'Templates', body: 'Start from a ready-made layout: banners, rounded bands, cell grids, status columns and more. A template also switches to the colours it was designed with.' },
    { target: '[data-tour="themes"]', title: 'Themes', body: 'A theme is the colours and the font. Pick one, change any colour, and save your own. Themes and templates are independent, so any colours go with any layout.' },
    card('layout', 'Fine-tune the layout', 'Everything a template sets can be adjusted here: row height, bar style and size, header, phase and marker styles, title, frame, grid and legend.'),
    card('look', 'Theme, template and legend', 'Pick the template and theme for this project, switch the today line and holiday shading on or off, and set up the legend. It is built from what you actually use.'),
    { target: '[data-tour="holidays"]', title: 'Holiday lists', body: 'Public holidays that are skipped when counting working days. Pick the date in the calendar, type a name, press Add: one holiday per row. Lists are shared between projects; switch one on for a project under Timeline view.' },
    { target: '.top details.menu:nth-of-type(2)', title: 'Export', body: 'Download the timeline as a PowerPoint slide (every bar and label is a real, editable shape), as an SVG (sharp at any size) or as a PNG.' },
    { target: '.top details.menu:nth-of-type(1)', title: 'Files', body: 'Save a project as a JSON file, back up all projects, or open a saved file. The Resource Loading Planner can import these files to plan people on your tasks.' },
    { title: 'You are ready', body: 'Add a phase and a few tasks, and watch the timeline build. Ctrl/Cmd+Z undoes a change.\n\nReplay this tour any time with “Quick tour” in the top bar.' },
  ];
}
