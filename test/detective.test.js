import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { DeadLinkDetective } from '../src/detective.js';
import { csvField } from '../src/reporters/csv.js';
import { escapeHtml } from '../src/reporters/html.js';
import { writeReports } from '../src/reporters/index.js';
import { startMockServer } from '../demo/mockServer.js';

let mock;
let outDir;
before(async () => {
  mock = await startMockServer();
  outDir = await mkdtemp(path.join(tmpdir(), 'dld-'));
});
after(async () => {
  await mock.close();
  await rm(outDir, { recursive: true, force: true });
});

const paths = ['/', '/about', '/old-page', '/missing', '/gone', '/slow', '/loop-a'];
const options = { timeout: 3000, slowThreshold: 1000, retryDelay: 10, concurrency: 4 };

test('detective checks every URL concurrently and summarises', async () => {
  const detective = new DeadLinkDetective(options);
  const events = [];
  detective.on('start', ({ total }) => events.push(`start:${total}`));
  detective.on('result', ({ done }) => events.push(`result:${done}`));
  detective.on('done', () => events.push('done'));

  const started = Date.now();
  const report = await detective.run(paths.map((p) => `${mock.baseUrl}${p}`));
  const elapsed = Date.now() - started;

  assert.equal(report.summary.total, 7);
  assert.equal(report.summary.ok, 3); // /, /about, /slow
  assert.equal(report.summary.redirects, 1);
  assert.equal(report.summary.broken, 2);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.summary.slow, 1);
  assert.equal(report.summary.healthScore, 57);
  assert.equal(events[0], 'start:7');
  assert.equal(events.at(-1), 'done');
  assert.equal(events.filter((e) => e.startsWith('result')).length, 7);
  assert.deepEqual(report.results.map((r) => r.url), paths.map((p) => `${mock.baseUrl}${p}`), 'input order kept');
  assert.ok(elapsed < 3000, `ran concurrently (took ${elapsed} ms)`);
  assert.equal(report.options.userAgent, undefined);
});

test('per-host limit serialises requests to one host', async () => {
  // Three 1.8 s responses from the same host with perHost=1 must take ~5.4 s, not ~1.8 s.
  const detective = new DeadLinkDetective({ ...options, concurrency: 10, perHost: 1 });
  const urls = ['/slow', '/slow?b=1', '/slow?c=1'].map((p) => `${mock.baseUrl}${p}`);
  const t0 = Date.now();
  await detective.run(urls);
  assert.ok(Date.now() - t0 >= 5000, 'requests to the same host ran one at a time');
});

test('stop() halts scheduling and marks the report interrupted', async () => {
  const detective = new DeadLinkDetective({ ...options, concurrency: 1 });
  detective.on('result', ({ done }) => { if (done === 2) detective.stop(); });
  const report = await detective.run(['/', '/about', '/docs', '/pricing'].map((p) => `${mock.baseUrl}${p}`));
  assert.equal(report.results.length, 2);
  assert.equal(report.interrupted, true);
});

test('reports are written in all formats, optionally gzipped', async () => {
  const detective = new DeadLinkDetective(options);
  const report = await detective.run(['/', '/missing'].map((p) => `${mock.baseUrl}${p}`));

  const files = await writeReports(report, { outDir, baseName: 'plain' });
  assert.equal(files.length, 3);
  const json = JSON.parse(await readFile(path.join(outDir, 'plain.json'), 'utf8'));
  assert.equal(json.summary.total, 2);
  const csv = (await readFile(path.join(outDir, 'plain.csv'), 'utf8')).trim().split('\n');
  assert.equal(csv.length, 3);
  assert.match(csv[0], /^url,category,status/);
  assert.match(csv[1], /missing,broken,404/); // broken sorted first
  assert.match(await readFile(path.join(outDir, 'plain.html'), 'utf8'), /Dead Link Detective/);

  await writeReports(report, { outDir, baseName: 'zipped', gzip: true, formats: ['json', 'csv'] });
  const unzipped = JSON.parse(gunzipSync(await readFile(path.join(outDir, 'zipped.json.gz'))).toString());
  assert.equal(unzipped.summary.broken, 1);

  const leftovers = (await readdir(outDir)).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no temp files left behind');
});

test('unknown report format is rejected', async () => {
  await assert.rejects(() => writeReports({ results: [], summary: {}, options: {} }, { outDir, formats: ['pdf'] }), RangeError);
});

test('csvField escapes commas, quotes and formula characters', () => {
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvField(-5), '-5');
  assert.equal(csvField(null), '');
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<script>"x"&\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;');
});
