// Counts the downloads of each tool's release files and writes one shields.io "endpoint" badge file per tool.
//
//   node .github/scripts/download-counts.mjs <output-dir>
//
// A release file named <tool>-v<version>.html (made by the Release workflow) counts for <tool>.
// Needs Node 18+. Reads GITHUB_REPOSITORY (owner/name) and, optionally, GITHUB_TOKEN for a higher API limit.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSET_RE = /^(?<tool>[a-z0-9][a-z0-9-]*)-v\d+\.\d+\.\d+[^/]*\.html$/;

/** Total downloads and number of releases per tool, from the GitHub releases API. Drafts and unrelated files are ignored. */
export function countDownloads(releases) {
  const totals = {};
  for (const rel of releases) {
    if (rel.draft) continue;
    const seen = new Set();
    for (const asset of rel.assets ?? []) {
      const m = ASSET_RE.exec(asset.name);
      if (!m) continue;
      const t = (totals[m.groups.tool] ??= { downloads: 0, releases: 0 });
      t.downloads += Number(asset.download_count) || 0;
      if (!seen.has(m.groups.tool)) { seen.add(m.groups.tool); t.releases++; }
    }
  }
  return totals;
}

/** 0, 842, 1.2k, 15k, 2.4M */
export function compact(n) {
  if (n < 1000) return String(n);
  const [div, suffix] = n < 1e6 ? [1e3, 'k'] : [1e6, 'M'];
  const v = n / div;
  return (v < 10 ? v.toFixed(1) : String(Math.round(v))).replace(/\.0$/, '') + suffix;
}

/** The JSON that shields.io's endpoint badge reads. */
export const badge = n => ({ schemaVersion: 1, label: 'downloads', message: compact(n), color: n > 0 ? 'blue' : 'lightgrey' });

/** Tools are the repository's top-level folders that have a package.json, so a tool with no downloads yet still gets a "0" badge. */
export function toolFolders(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && existsSync(join(root, d.name, 'package.json')))
    .map(d => d.name);
}

async function fetchReleases(repo, token) {
  const all = [];
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'download-counts', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub API answered ${res.status} for ${repo}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: download-counts.mjs <output-dir>');
  const repo = process.env.GITHUB_REPOSITORY || 'rkmighwal/docs-helpers';
  const totals = countDownloads(await fetchReleases(repo, process.env.GITHUB_TOKEN));
  for (const tool of toolFolders(process.cwd())) totals[tool] ??= { downloads: 0, releases: 0 };
  mkdirSync(out, { recursive: true });
  for (const [tool, t] of Object.entries(totals)) {
    writeFileSync(join(out, `${tool}.json`), JSON.stringify(badge(t.downloads)) + '\n');
    console.log(`${tool}: ${t.downloads} download${t.downloads === 1 ? '' : 's'} from ${t.releases} release${t.releases === 1 ? '' : 's'}`);
  }
  writeFileSync(join(out, 'counts.json'), JSON.stringify(totals, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
