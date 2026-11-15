import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { DeadLinkDetective } from '../src/detective.js';
import { writeReports } from '../src/reporters/index.js';
import { startReportServer } from '../src/server.js';
import { startMockServer } from '../demo/mockServer.js';

let mock;
let server;
let dir;
let base;

before(async () => {
  mock = await startMockServer();
  dir = await mkdtemp(path.join(tmpdir(), 'dld-srv-'));
  const report = await new DeadLinkDetective({ timeout: 2000 }).run(
    ['/', '/about', '/missing', '/gone', '/old-page'].map((p) => `${mock.baseUrl}${p}`),
  );
  await writeReports(report, { outDir: dir });
  server = await startReportServer({ dir, port: 0 });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
  await rm(dir, { recursive: true, force: true });
});

const getJson = async (route) => {
  const res = await fetch(`${base}${route}`);
  return { status: res.status, body: await res.json() };
};

test('GET / serves the HTML dashboard', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Dead Link Detective/);
});

test('GET /api/summary returns totals', async () => {
  const { status, body } = await getJson('/api/summary');
  assert.equal(status, 200);
  assert.equal(body.total, 5);
  assert.equal(body.broken, 2);
});

test('GET /api/results filters with query strings', async () => {
  assert.equal((await getJson('/api/results?category=broken')).body.count, 2);
  assert.equal((await getJson('/api/results?status=404')).body.count, 1);
  assert.equal((await getJson('/api/results?status=4xx')).body.count, 2);
  assert.equal((await getJson('/api/results?q=about')).body.count, 1);
  assert.equal((await getJson('/api/results?limit=2')).body.results.length, 2);
});

test('unknown routes give 404 JSON, other methods give 405', async () => {
  const missing = await getJson('/nope');
  assert.equal(missing.status, 404);
  assert.ok(missing.body.routes.includes('/api/results'));
  const post = await fetch(`${base}/api/results`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal((await getJson('/health')).body.status, 'ok');
});
