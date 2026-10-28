import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_RE, badge, compact, countDownloads, toolFolders } from './download-counts.mjs';

const asset = (name, n) => ({ name, download_count: n });

test('adds up each tool across its releases', () => {
  const t = countDownloads([
    { assets: [asset('timeline-builder-v1.0.0.html', 10), asset('resource-loading-planner-v1.0.0.html', 3)] },
    { assets: [asset('timeline-builder-v1.1.0.html', 32)] },
  ]);
  assert.deepEqual(t, { 'timeline-builder': { downloads: 42, releases: 2 }, 'resource-loading-planner': { downloads: 3, releases: 1 } });
});

test('ignores drafts and files that are not tool builds', () => {
  const t = countDownloads([
    { draft: true, assets: [asset('timeline-builder-v9.9.9.html', 999)] },
    { assets: [asset('notes.txt', 50), asset('timeline-builder.html', 7), asset('timeline-builder-v1.0.0.html', 5)] },
    { assets: undefined },
  ]);
  assert.deepEqual(t, { 'timeline-builder': { downloads: 5, releases: 1 } });
});

test('tool names may contain dashes and digits', () => {
  assert.equal(ASSET_RE.exec('my-tool-2-v1.2.3.html').groups.tool, 'my-tool-2');
  assert.equal(ASSET_RE.exec('x-v1.0.0-beta.1.html').groups.tool, 'x');
  assert.equal(ASSET_RE.exec('x-v1.0.html'), null);
});

test('compact numbers', () => {
  assert.deepEqual([0, 7, 999, 1000, 1234, 9999, 10400, 15000, 999999, 1200000, 2400000].map(compact), ['0', '7', '999', '1k', '1.2k', '10k', '10k', '15k', '1000k', '1.2M', '2.4M']);
});

test('badge file follows the shields.io endpoint format', () => {
  assert.deepEqual(badge(0), { schemaVersion: 1, label: 'downloads', message: '0', color: 'lightgrey' });
  assert.deepEqual(badge(1500), { schemaVersion: 1, label: 'downloads', message: '1.5k', color: 'blue' });
});

test('tools are the folders with a package.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-'));
  for (const d of ['a-tool', 'b-tool', 'docs', '.github', 'node_modules']) mkdirSync(join(root, d));
  for (const d of ['a-tool', 'b-tool', 'node_modules']) writeFileSync(join(root, d, 'package.json'), '{}');
  assert.deepEqual(toolFolders(root).sort(), ['a-tool', 'b-tool']);
});
