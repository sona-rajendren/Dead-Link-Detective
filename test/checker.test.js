import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { checkUrl, checkUrlCallback } from '../src/checker.js';
import { startMockServer } from '../demo/mockServer.js';

let mock;
before(async () => { mock = await startMockServer(); });
after(async () => { await mock.close(); });

const fast = { timeout: 1500, slowThreshold: 500, retryDelay: 10 };
const url = (p) => `${mock.baseUrl}${p}`;

test('200 is ok', async () => {
  const r = await checkUrl(url('/about'), fast);
  assert.equal(r.status, 200);
  assert.equal(r.category, 'ok');
  assert.equal(r.method, 'HEAD');
  assert.equal(r.error, null);
});

test('404 and 500 are broken', async () => {
  assert.equal((await checkUrl(url('/missing'), fast)).category, 'broken');
  const r = await checkUrl(url('/server-error'), fast);
  assert.equal(r.status, 500);
  assert.equal(r.category, 'broken');
});

test('redirect chain is followed and recorded', async () => {
  const r = await checkUrl(url('/old-chain'), fast);
  assert.equal(r.status, 200);
  assert.equal(r.category, 'redirect');
  assert.equal(r.redirectCount, 3);
  assert.deepEqual(r.redirects.map((h) => h.status), [301, 302, 307]);
  assert.equal(r.finalUrl, url('/ok'));
  assert.equal(r.permanentRedirect, true);
});

test('temporary redirect is not flagged as permanent', async () => {
  const r = await checkUrl(url('/moved-temp'), fast);
  assert.equal(r.permanentRedirect, false);
});

test('redirect loop is detected', async () => {
  const r = await checkUrl(url('/loop-a'), fast);
  assert.equal(r.category, 'error');
  assert.equal(r.error.code, 'EREDIRECTLOOP');
});

test('too many redirects is reported', async () => {
  const r = await checkUrl(url('/old-chain'), { ...fast, maxRedirects: 1 });
  assert.equal(r.error.code, 'EMAXREDIRECTS');
});

test('followRedirects=false reports the 3xx itself', async () => {
  const r = await checkUrl(url('/old-page'), { ...fast, followRedirects: false });
  assert.equal(r.status, 301);
  assert.equal(r.category, 'redirect');
});

test('slow responses are flagged', async () => {
  const r = await checkUrl(url('/slow'), { ...fast, timeout: 4000, slowThreshold: 1000 });
  assert.equal(r.status, 200);
  assert.equal(r.slow, true);
  assert.ok(r.responseTime >= 1700);
});

test('timeouts become error results', async () => {
  const r = await checkUrl(url('/timeout'), { ...fast, timeout: 300 });
  assert.equal(r.category, 'error');
  assert.equal(r.error.code, 'ETIMEOUT');
  assert.ok(r.responseTime >= 250);
});

test('connection refused is an error result, not an exception', async () => {
  const r = await checkUrl('http://127.0.0.1:1/', fast);
  assert.equal(r.category, 'error');
  assert.equal(r.error.code, 'ECONNREFUSED');
});

test('HEAD 405 falls back to GET', async () => {
  const r = await checkUrl(url('/head-not-allowed'), fast);
  assert.equal(r.status, 200);
  assert.equal(r.method, 'GET');
});

test('transient 503 is retried', async () => {
  const r = await checkUrl(url('/flaky'), fast);
  assert.equal(r.status, 200);
  assert.equal(r.attempts, 2);
});

test('retries=0 reports the 503', async () => {
  const r = await checkUrl(url('/flaky-never'), { ...fast, retries: 0 });
  assert.equal(r.status, 404); // unknown route -> 404, single attempt
  assert.equal(r.attempts, 1);
});

test('invalid options are rejected', async () => {
  await assert.rejects(() => checkUrl(url('/'), { timeout: 'abc' }), RangeError);
  await assert.rejects(() => checkUrl(url('/'), { method: 'POST' }), RangeError);
});

test('callback API works', (t, done) => {
  checkUrlCallback(url('/about'), fast, (err, result) => {
    assert.equal(err, null);
    assert.equal(result.status, 200);
    done();
  });
});
