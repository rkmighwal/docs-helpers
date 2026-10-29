import type { TourStep } from './ui/tour';

export interface TourApi {
  /** Open one editor section (and fold the others) so the step can describe what is inside it. */
  showCard: (id: string) => void;
}

/** The sections the tour opens. */
export const TOUR_CARDS = ['timeline', 'workstreams', 'skills', 'resources', 'tasks', 'loading', 'cost', 'content', 'look'] as const;

export function plannerTour(api: TourApi): TourStep[] {
  const card = (id: (typeof TOUR_CARDS)[number], title: string, body: string): TourStep => ({ target: `[data-card="${id}"]`, title, body, before: () => api.showCard(id) });
  return [
    {
      title: 'Welcome to the Resource Loading Planner',
      body: 'It answers one question: how many people of which skill are needed on each work stream, and when? You describe the work; it adds everything up per week, month, quarter or year and exports the result to Excel, PNG or SVG.\n\nThis one-minute tour shows where everything is. Use the Next button, the arrow keys, or Esc to skip. You can replay it any time from “Quick tour” in the top bar.',
    },
    { target: '.side', title: 'Your projects', body: 'Every plan is a project. Add, copy, reorder or delete them here. Projects save automatically in this browser; use File ▸ Save project as JSON to keep a file you can import later or share.' },
    card('timeline', '1 · Set the timeline', 'Start here. Choose what one column is (a week, month, quarter or year), group the columns under months or years, and set a start date, or switch to “no dates” for Week 1, Week 2…\n\nTick the days of the week that count as working days (Mon–Fri, Sun–Thu, any mix) and attach holiday lists.'),
    card('workstreams', '2 · Work streams', 'The streams of work you load people onto, for example Backend, Frontend, QA. Type a name and press Enter; each gets a colour you can change.'),
    card('skills', '3 · Skills', 'What people are loaded as: Developer, Designer, Tester… Everything is totalled by skill, and a skill can carry a standard cost per person-day later on.'),
    card('resources', '4 · Resources (optional)', 'Add named people with their skills (the first one ticked is their primary skill) and availability. They give you available capacity and warn you when someone is over-allocated.\n\nYou can also plan with plain numbers and skip this.'),
    card('tasks', '5 · Tasks (optional)', 'Import the tasks and timeline from a Timeline Builder project, or add tasks by hand. Each task becomes a row in the table that you can put people on.'),
    card('loading', '6 · Resource loading', 'The heart of the tool. Each line says: this many people, of this skill, on this work stream, between these dates.\n\nPick a named resource (only people with that skill are listed) or leave it as a plain number. The table adds everything up for you.'),
    card('cost', '7 · Cost (optional)', 'Put a price on the plan: a cost per person-day on resources or skills, a currency, and how many working days make a person-month.\n\nHover any cost figure in the table to see exactly how it is calculated. You can hide cost, or leave it out of an export.'),
    card('content', 'Choose what the table shows', 'Group rows by work stream, skill or resource; show one row per task, skill or line; pick what a cell means (peak headcount, average FTE or person-days); add capacity, spare / shortfall, and “Loading by skill” with the people under each skill.'),
    card('look', 'Make it look right', 'Browse ready-made templates, change the theme, show numbers as a heat map, bars, chips or filled cells, and switch each border on or off.'),
    { target: '.preview-scroll', title: 'The live preview', body: 'This is exactly what you will export. Hover a cell for details, click a row to jump to its resource line, and use Fit width and the zoom slider to get a good view.' },
    { target: '[data-tour="holidays"]', title: 'Holiday lists', body: 'Dates that are not working days. Pick the date in the calendar, type a name, press Add: one holiday per row. Lists are shared between projects; switch one on for a project under Timeline.' },
    { target: '.top details.menu:nth-of-type(2)', title: 'Export', body: 'Download the table as an Excel workbook (the plan plus the data behind it, and a Cost sheet if you use cost), as an SVG for slides, or as a PNG.' },
    { target: '.top details.menu:nth-of-type(1)', title: 'Files', body: 'Save a project as a JSON file, back up all projects, open a saved file, or import tasks and the timeline from Timeline Builder.' },
    { title: 'You are ready', body: 'Add a work stream, a skill and a first resource line, and watch the table fill in. Ctrl/Cmd+Z undoes a change.\n\nReplay this tour any time with “Quick tour” in the top bar.' },
  ];
}
