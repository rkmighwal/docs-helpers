# docs-helpers

Contains different tools which can help to build different artifacts at different stages of documentations, majorly focused on architecture and proposals documentations.

Every tool lives in its own folder, runs fully offline in the browser, and is free to use under the [MIT License](LICENSE).

## Available tools

| Tool | What it does | Folder |
| --- | --- | --- |
| **Timeline Builder** | Build project timelines (Gantt-style) with tasks, phases, milestones, gates and holidays, then export them as SVG or PNG for slides and documents. | [timeline-builder/](timeline-builder/) |

More tools will be added here over time.

## Timeline Builder

An offline, single-file HTML tool. Highlights:

- Weekly, monthly, quarterly or yearly views, optionally grouped (for example months under quarters).
- Real calendar dates, or relative timelines with no dates (Week 0, Week 1, …).
- Set either the end date or the number of working days; the other is calculated, skipping weekends and public holidays.
- Reusable public-holiday lists shared across projects.
- Drag and drop to reorder rows, and to move or resize bars.
- Many projects, auto-saved in the browser, with JSON import/export and backup.
- Selectable and customisable designs, plus per-item colours, icons and bar styles.
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

## Adding a new tool

1. Create a new folder at the repository root, named after the tool.
2. Keep it self-contained, with its own `README.md`, build and tests, and make it work offline.
   Commit the built, ready-to-use output (for example `dist/`) so users don't need a build setup.
3. Add a row to the **Available tools** table above.

## License

[MIT](LICENSE) © 2026 Rohit Mighwal
