# Resource Loading Planner

An offline, single-file HTML tool for planning **how many people of which skill are loaded onto which work stream, and when**. It totals the load per week, month, quarter or year, and exports the table as Excel, PNG or SVG for proposals, architecture documents and slides. No server, no network, no account.

## Use it

The built app is committed in this repository as [`dist/index.html`](dist/index.html), a single self-contained file. Download it and open it in any modern browser (double-click works, `file://` is fine). No Node.js, install or network needed; copy the file anywhere.

## Build it yourself

Only needed to change the tool or verify the build (requires Node.js 18+):

```sh
npm install
npm run build      # -> dist/index.html (one self-contained file, ~135 kB)
```

The built file is checked into git; rebuild and commit it after changing the source.

Development: `npm run dev` (hot reload), `npm test` (Vitest), `npm run build` (type-check + bundle). The stack matches Timeline Builder: Vite + TypeScript, no runtime dependencies.

## Quick start

1. **Timeline** – pick the grain (week / month / quarter / year), a start date (or *No dates* for “Week 1, Week 2…”), and the days of the week that count as working days.
2. **Work streams** and **Skills** – add the streams of work (Backend, QA…) and the skills people are loaded as (Developer, Tester…).
3. **Resources** (optional) – add named people with their skills and availability. They provide *available capacity* and flag over-allocation.
4. **Tasks** (optional) – import tasks and the timeline from [Timeline Builder](../timeline-builder/), or add them by hand.
5. **Resource loading** – add lines such as *Backend · Developer · 3 people · Oct → Dec*. The table totals everything for you.
6. Choose a **template**, tweak the theme and borders, then **Export**.

## Features

- **Timeline**: weekly, monthly, quarterly or yearly columns, optionally grouped under a higher level (weeks under months / quarters / years, months under quarters / years, quarters under years). Real dates with a start date, or a *relative* timeline with no dates; switching keeps everything in its period.
- **Working days**: choose which days of the week count (Mon–Fri, Mon–Sat, Sun–Thu, any combination) and attach public-holiday lists. Only working days carry load; an optional *working days* row shows the count per column.
- **Work streams, skills, resources**: your own lists with colours. A resource has skills (the first is the primary one), an availability in FTE and an optional availability window.
- **Resource loading lines**: *N people of skill S on work stream W between two dates.* Anonymous (“3 developers”) or assigned to a named resource — the choice of people is limited to those who have the line’s skill; a resource is always written with their skills, e.g. “Alice (Developer, Tester)”; optionally linked to a task so the line follows the task’s dates.
- **Automatic totals** per column at the chosen grain: group subtotals, a total row, available capacity, spare / shortfall, and a *loading by skill* summary. Cells that exceed the available capacity are flagged.
- **Measures**: *Headcount (peak)* — the most people loaded at the same time in the period; *Average FTE* — averaged over the working days; *Person-days* — people × working days. Totals use the true concurrent load, not a sum of peaks.
- **Tasks as rows**: once the project has tasks (imported or added), each task is a row under its work stream, with the resource lines linked to it added together; tasks with no resource yet are listed as blank rows so every imported task is visible. Choose instead one row per skill, or one row per resource line, under *Table content ▸ Rows*.
- **Named resources in the outcome**: the *Resource* column shows who is assigned to each row, and in *Loading by skill* (switch it on under *Table content ▸ Loading by skill*; the named people under each skill are a separate tick-box inside it) every named person is listed under their skill (each resource is counted under its primary skill) with their own load per column, flagged where it exceeds their availability. People with nothing assigned are listed too, so spare capacity is visible; a person's row shows all their work, even lines booked under another skill.
- **Cost** (optional): give each resource a cost per person-day — or a standard rate per skill, which prices lines with no named resource and resources without a rate of their own. The tool shows the cost per month / quarter / … for each group, the total cost, and the effort in person-months. A *person-month* is a number of working days: automatic (working days per week × 52 ÷ 12, e.g. 21.67 for Mon–Fri) or your own number (say 20 or 22); each rate is also shown per person-month. Pick the currency from a list of 33 (or type your own symbol or code); every cost figure is shown with it — $343,000, €1.25M, 12,000 kr — in the table, the preview, SVG / PNG and as a real currency number format in Excel. Switch the whole feature on or off, or just hide the cost rows from the table, without losing the rates. Resource lines with no rate are called out, not silently priced at zero. Hover any cost figure — a period, a group, the total, the effort — to see how it is calculated: each line as people × working days × rate, the person-month division, and the sum (a tip above the preview tells you so when cost is switched on).
- **Row layout**: group rows by work stream, skill, resource or not at all; show or hide Skill, Resource, Start, End, Qty and Total columns.
- **Table look**: cells as numbers, heat map, in-cell bars, coloured chips or filled Gantt-style cells; header, group and zebra styles; alignment, row height, corner radius, column width.
- **Borders**: switch each kind of line on or off independently — outer frame, under the header, between rows, between columns, around the label columns, above groups, around the total row — plus line style (solid, dashed, dotted) and thickness.
- **Themes**: 19 built-in colour themes, fully editable (every colour, font and size); save your own, export and import them as `.theme.json`.
- **Templates**: 13 ready-made table designs inspired by popular looks — spreadsheet grid, clean sheet, minimal notes, striped table, Material data table, docs table, resource heat map, capacity bars, chips, Gantt fill, consulting navy, dark dashboard, print black-and-white — shown as live thumbnails.
- **Projects**: many projects in the sidebar; new, duplicate, reorder, delete; auto-saved in the browser; undo / redo (Ctrl/Cmd+Z, Shift+Z).
- **Files**: *Save project as JSON* writes a portable file (includes the holiday lists and custom theme it uses) that *Open / import* reads back later; *Backup all projects* saves everything.
- **Export**: Excel workbook (`.xlsx`), SVG (vector, ideal for slides) and PNG at 1×, 2× or 4×.
- **Collapsible panels**: every editor section, the editor itself and the project list fold away to give the preview room. Click a row in the preview to jump to its resource line.

## Import from Timeline Builder

In Timeline Builder use *File ▸ Save project as JSON* (a full backup works too). In this tool use *File ▸ Import tasks & timeline from Timeline Builder…* (or the *Tasks* section) and choose the file. You decide what comes across:

- tasks and phases (and optionally milestones and gates) as tasks;
- each top-level phase as a **work stream**, with its tasks filed under it;
- the timeline settings: grain, start date or relative numbering, number of columns, working days (the inverse of the timeline’s weekend days);
- the holiday lists the timeline uses;
- one resource line per task (1 person, skill still to choose), linked to the task so it follows its dates.

Imported tasks show up in the table immediately, as rows under their work stream, whether or not they have resource lines yet.

Importing can replace or add to the existing tasks, and can be undone with Ctrl/Cmd+Z.

## Excel export

The workbook contains four sheets, plus a fifth *Cost* sheet when cost calculations are in use:

| Sheet | Content |
| --- | --- |
| **Loading plan** | The table as previewed: theme colours, heat-map / chip / fill colouring, borders, merged group headers, frozen header and label column. Values only, so the figures stay exactly as shown. |
| **Cost** | Only when cost is in use. The person-month definition in one editable cell, a rate card (cost per person-day, per person-month, person-days, person-months, cost) and the cost per period for each work stream. The month rates, person-months and costs are live formulas on that cell, so changing the number of days in Excel recalculates them. |
| **Allocations** | One row per resource line: work stream, skill, resource, task, dates, count, note. Filterable. |
| **Resources** | Each person with skills, availability, availability window and their peak load against it (plus their cost per person-day, when the Cost sheet is included). |
| **Calendar** | The working days of the week and the project’s holidays. |

The `.xlsx` is written by a small built-in ZIP/XML writer, so the tool still needs no libraries and works offline.

## Leaving cost out of an export

Whenever cost is in use (switched on, with at least one rate), *Export ▸ Excel* asks what to include: **the Cost sheet** (which also carries the cost-per-day column of the Resources sheet) and **the cost rows of the plan**. For SVG / PNG it asks about the cost rows, when they are shown. Unticking leaves cost out entirely — no sheet, no rate column, no cost rows, no mention in the legend. The choice is remembered and can be changed under *Cost ▸ Show and export*. If cost is off, or no rate is set, nothing about cost is exported and nothing is asked.

## How the numbers work

Every allocation adds its count to each *working day* between its start and end. The cell for a column then summarises those days: the peak (headcount), the mean over the column’s working days (FTE) or the sum (person-days). A group, total or skill row is summarised from the **combined** daily load, so two people who overlap for one day count as two in that period, while two people in different weeks count as one. Cost is the same daily load times the rate that applies to each line, summed over the period, so weekends, non-working days and holidays are free. Available capacity is built the same way from the resources’ availability, counted under each person’s primary skill.

In *no dates* mode the columns are counted from a fixed reference calendar (the first column is a Monday / the first of a month), so month lengths in person-days follow that calendar.

## Layout

| File | Purpose |
| --- | --- |
| `src/model.ts` | Types, defaults, JSON normalisation / repair, dated ⇄ relative conversion, sample project |
| `src/dates.ts`, `src/scale.ts` | Date maths and the column axis (grain, grouping, labels) |
| `src/cost.ts` | Rates, person-month days, cost per period, totals and money formatting |
| `src/calc.ts` | Working calendar, daily load, per-column aggregation, capacity, resource utilisation |
| `src/table.ts` | Turns a project into table rows (grouping, subtotals, total, capacity, skill summary) |
| `src/render.ts` | Pure `renderPlan()` → SVG string (used for the preview, SVG and PNG export) |
| `src/excel.ts`, `src/xlsx.ts` | Workbook content and the dependency-free `.xlsx` writer |
| `src/themes.ts`, `src/templates.ts` | Built-in colour themes and table templates, validation |
| `src/tbimport.ts` | Reading Timeline Builder files and applying an import |
| `src/store.ts`, `src/storage.ts`, `src/export.ts` | State and undo, autosave to local storage, JSON files, PNG |
| `src/ui/` | DOM UI: app shell, dialogs |
| `tests/` | Vitest unit tests for the maths, rendering, export and import |

## Version and license

The footer shows the product version, publish date and license type; clicking **MIT License** (or *File ▸ About*) opens the full license text, which is bundled into the page so it works offline. To release a new version, edit `version` and `releaseDate` in `package.json` and rebuild. The license text is read from the repository’s top-level `LICENSE` file at build time.
