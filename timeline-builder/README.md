# Timeline Builder

An offline, single-file HTML tool for building project timelines (Gantt-style) and exporting them as SVG or PNG for slides and documents. No server, no network, no account.

## Use it

The built app is committed in this repository as [`dist/index.html`](dist/index.html), a single self-contained file. Download it and open it in any modern browser (double-click works, `file://` is fine). No Node.js, install or network needed; copy the file anywhere.

## Build it yourself

Only needed to change the tool or verify the build (requires Node.js 18+):

```sh
npm install
npm run build      # -> dist/index.html (one self-contained file, ~95 kB)
```

The built file is checked into git; rebuild and commit it after changing the source.

Development: `npm run dev` (hot reload), `npm test` (Vitest), `npm run build` (type-check + bundle).

## Features

- **Items**: tasks (with % complete), phases/groups (auto-span their indented children), milestones, gates/check-points, holiday/freeze bands, notes.
- **Views**: weekly, monthly, quarterly, yearly; choose the start week/month/quarter/year and how many periods to show.
- **Sub-division**: choose what one column is (week, month, quarter, year) and what the columns are grouped under in a header row: weeks under months / quarters / years, months under quarters / years, quarters under years. Also works for relative timelines (e.g. Month 0–2 under Quarter 0).
- **Relative timelines**: choose *Relative — no dates* and columns become Week 0, Week 1, Week 2… (or Month 1…, Quarter 1…). Items are then placed by period number instead of date. You can also keep real dates but label columns Week 0, 1, 2…; switching between modes keeps every item in its period.
- **Dates**: edit *End date* or *Working days*; the other is calculated, counting only the working days you choose per project (Mon–Fri, Sun–Thu, any combination) and skipping public holidays.
- **Drag & drop**: reorder rows by the ⠿ handle (a phase moves with its children); drag bars in the preview to move them, drag bar edges to resize.
- **Holiday lists**: create reusable lists (`YYYY-MM-DD, Name` per line, or import JSON/CSV) and attach any of them to any project.
- **Projects**: many projects in the sidebar; new, duplicate, reorder, delete. Auto-saved to browser local storage on every change.
- **Files**: *Save project (JSON)* writes a portable file (includes the holiday lists and custom design it uses); *Import JSON* accepts a project file or a full backup (*Backup all projects*). Uses the native save dialog where the browser supports it, otherwise downloads.
- **Export**: SVG (vector, ideal for PowerPoint/Keynote/Google Slides) and PNG at 1–4× resolution.
- **Themes and templates**, kept separate. A *theme* is the colours and the font: sixteen built in, fully editable, savable, exportable and importable as `.theme.json`. A *template* is the layout: sixteen built in (title banners, footer bands, rounded row bands, status text in bars, cell-filled grids, vertical phase pills, boxed legends, highlighted current period, outlined / gradient / striped / raised bars…), shown as live thumbnails. Choosing a template also switches to the theme it was designed with; changing the theme afterwards keeps the layout. The *Layout & style* section fine-tunes everything a template sets: header, bars, phases, markers, title, frame, rows, progress, legend style, row height, bar size / radius, grid and striping.
- **Item looks**: per item, pick a colour, a marker shape / icon from a preset set (diamond, star, flag, check, target…) and a bar style (solid, outline, gradient, striped, raised).
- **Legend**: generated from the item types, colours and icons actually used (give an item a *Legend label* to name its look), plus public holidays, weekends, today line and your own custom entries; placed bottom, top or right and included in exports.
- Undo/redo (Ctrl/Cmd+Z, Shift+Z) per project.

## Themes and templates

**Themes** (colours and font). Open **Themes**, tweak a built-in or custom theme, then **Export theme**. The file looks like:

```json
{ "name": "My theme", "fontFamily": "Arial, sans-serif",
  "colors": { "bg": "#ffffff", "text": "#1f2937", "task": "#3b82f6", "...": "..." } }
```

Anyone can load it with **Import theme**. To ship a theme as built in, add an entry to `BUILTIN_THEMES` in `src/themes.ts`.

**Templates** (layout). A template holds the row height, bar height and radius, grid, striping and the `design` block (header, bar, phase and marker styles, title, frame, rows, progress, legend…), plus the id of the theme it goes with. Each project stores its own copy of the layout (`style`), so editing it in *Layout & style* never changes the template. To ship a template as built in, add an entry to `TEMPLATES` in `src/templates.ts`.

Files and browser data saved before themes and templates were separated open as before: the old combined design becomes the project's layout (a built-in one maps to the template with the same name; a custom one is kept as the project's own layout) and its colours become the theme.

## Layout

| File | Purpose |
| --- | --- |
| `src/model.ts` | Types, defaults, JSON normalisation/migration, end-date ⇄ working-days recalculation |
| `src/dates.ts` | Date maths, working-day logic, period alignment |
| `src/scale.ts` | Week/month/quarter/year column axis and date ⇄ x mapping |
| `src/render.ts` | Pure `renderTimeline()` → SVG string (used for screen and export) |
| `src/themes.ts` | Built-in colour themes, validation, `lookOf()` (theme + layout as the renderer uses them) |
| `src/templates.ts` | Built-in layout templates, applying a template, migration of older files |
| `src/store.ts`, `src/storage.ts` | State, undo, autosave to localStorage |
| `src/export.ts` | JSON import/export/merge, file save, SVG → PNG |
| `src/ui/` | DOM UI: app shell, dialogs |

## Version and license

The footer shows the product version, publish date and license type; clicking **MIT License** (or *File ▸ About*) opens the full license text, which is bundled into the page so it works offline. To release a new version, edit `version` and `releaseDate` in `package.json` and rebuild. The license text is read from the repository's top-level `LICENSE` file at build time.
