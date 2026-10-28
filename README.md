# docs-helpers

Contains different tools which can help to build different artifacts at different stages of documentations, majorly focused on architecture and proposals documentations.

Every tool lives in its own folder, runs fully offline in the browser, and is free to use under the [MIT License](LICENSE).

## Available tools

| Tool | What it does | Folder | Downloads |
| --- | --- | --- | --- |
| **Timeline Builder** | Build project timelines (Gantt-style) with tasks, phases, milestones, gates and holidays, then export them as SVG or PNG for slides and documents. | [timeline-builder/](timeline-builder/) | [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Frkmighwal%2Fdocs-helpers%2Fbadges%2Ftimeline-builder.json)](https://github.com/rkmighwal/docs-helpers/releases) |
| **Resource Loading Planner** | Plan how many people of which skill are loaded onto which work stream over time, with automatic totals per week, month, quarter or year. Import tasks from Timeline Builder; export as Excel, PNG or SVG. | [resource-loading-planner/](resource-loading-planner/) | [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Frkmighwal%2Fdocs-helpers%2Fbadges%2Fresource-loading-planner.json)](https://github.com/rkmighwal/docs-helpers/releases) |

More tools will be added here over time.

### Downloads

The download badges count how many times each tool's **release file** was downloaded from the [Releases page](https://github.com/rkmighwal/docs-helpers/releases); they refresh daily and after each release. Copying `dist/index.html` straight from the repository, or cloning it, is not counted (GitHub does not report those), so the number is a floor, not a total. The tools themselves never count or send anything: they make no network requests.

## Timeline Builder

An offline, single-file HTML tool. Highlights:

- Weekly, monthly, quarterly or yearly views, optionally grouped (for example months under quarters).
- Real calendar dates, or relative timelines with no dates (Week 0, Week 1, …).
- Set either the end date or the number of working days; the other is calculated, skipping the days you mark as non-working and public holidays.
- Reusable public-holiday lists shared across projects.
- Drag and drop to reorder rows, and to move or resize bars.
- Many projects, auto-saved in the browser, with JSON import/export and backup.
- Colour themes and layout templates kept separate: pick a template for the look, a theme for the colours, and fine-tune either; plus per-item colours, icons and bar styles.
- An automatic legend, and SVG or PNG export.

### Use it

No installation or Node.js needed. The ready-to-use app is a single file that is committed to this repository:

**[timeline-builder/dist/index.html](timeline-builder/dist/index.html)**

Download that file (on GitHub, open it and use the *Download raw file* button, or clone the repo), then open it in any modern browser; double-clicking works. You can copy it anywhere, email it, or put it on a USB stick. It makes no network requests, and your projects stay in your browser's local storage on that device.

### Develop or rebuild it

Only needed if you want to change the tool. This requires [Node.js](https://nodejs.org) 18 or newer.

```sh
cd timeline-builder
npm install        # once
npm run dev        # local dev server with hot reload
npm test           # unit tests (Vitest)
npm run build      # type-check and produce dist/index.html
```

The built `dist/index.html` is committed, so remember to rebuild and commit it after changing the tool's source.

See [timeline-builder/README.md](timeline-builder/README.md) for the full feature list, how to publish your own designs, and the source layout.

### Version and license

The footer of each tool shows its version, publish date and license; click the license name to read the full text. A new release is made by updating `version` and `releaseDate` in the tool's `package.json` and rebuilding.

## Resource Loading Planner

An offline, single-file HTML tool, built the same way as Timeline Builder (Vite + TypeScript). Highlights:

- Define work streams, skills and resources, then load *N people of skill S on work stream W between two dates*.
- Totals per week, month, quarter or year (optionally grouped), counting only the working days you choose and skipping holidays; compares the load with available capacity and flags over-allocation.
- Real calendar dates or a relative timeline with no dates.
- Import tasks, phases and the timeline straight from a Timeline Builder JSON file.
- Table output with per-line border control, editable themes and 13 templates; export as Excel (`.xlsx`), SVG or PNG.
- Many projects, auto-saved in the browser, with JSON import/export.

### Use it

No installation needed: download **[resource-loading-planner/dist/index.html](resource-loading-planner/dist/index.html)** and open it in any modern browser. Rebuild with `npm install && npm run build` inside `resource-loading-planner/` (Node.js 18+); `npm test` runs the unit tests.

See [resource-loading-planner/README.md](resource-loading-planner/README.md) for the full feature list, the Timeline Builder import and the Excel layout.

## Publishing a release

A release is what makes a download countable. For a tool in folder `<tool>`:

1. Set `version` (and `releaseDate`) in `<tool>/package.json`, rebuild, and commit as usual.
2. Tag it and push the tag:

   ```sh
   git tag <tool>-v<version>          # e.g. timeline-builder-v1.1.0
   git push origin <tool>-v<version>
   ```

The **Release** workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) checks that the tag matches `package.json`, runs the tests, builds, and publishes a GitHub Release carrying `<tool>-v<version>.html`. The **Download counts** workflow ([.github/workflows/download-counts.yml](.github/workflows/download-counts.yml)) then sums the downloads of every release of each tool into a badge file on the `badges` branch, which the badges above read. To try the counter by hand: `node .github/scripts/download-counts.mjs /tmp/badges` (and `node --test .github/scripts/download-counts.test.mjs` for its tests).

The first time, the badges show nothing useful until the *Download counts* workflow has run once (Actions tab ▸ *Download counts* ▸ *Run workflow*).

## Adding a new tool

1. Create a new folder at the repository root, named after the tool.
2. Keep it self-contained, with its own `README.md`, build and tests, and make it work offline.
   Commit the built, ready-to-use output (for example `dist/`) so users don't need a build setup.
3. Add a row to the **Available tools** table above, with its download badge (copy one and change the file name `<tool>.json`).
4. Publish it as a release (see above). Any folder with a `package.json` gets a badge file automatically.

## License

[MIT](LICENSE) © 2026 Rohit Mighwal
