import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATEGORY, classify, describeError, isPermanentRedirect, statusText } from '../src/classify.js';

test('classify: 2xx without redirects is ok', () => {
  assert.equal(classify({ status: 200, redirectCount: 0, error: null }), CATEGORY.OK);
});

test('classify: followed redirects are reported as redirect', () => {
  assert.equal(classify({ status: 200, redirectCount: 2, error: null }), CATEGORY.REDIRECT);
  assert.equal(classify({ status: 301, redirectCount: 0, error: null }), CATEGORY.REDIRECT);
});

test('classify: 4xx and 5xx are broken', () => {
  assert.equal(classify({ status: 404, redirectCount: 0, error: null }), CATEGORY.BROKEN);
  assert.equal(classify({ status: 503, redirectCount: 0, error: null }), CATEGORY.BROKEN);
});

test('classify: any error wins', () => {
  assert.equal(classify({ status: null, redirectCount: 0, error: new Error('x') }), CATEGORY.ERROR);
  assert.equal(classify({ status: 302, redirectCount: 3, error: new Error('loop') }), CATEGORY.ERROR);
});

test('helpers: permanent redirects and status text', () => {
  assert.ok(isPermanentRedirect(301) && isPermanentRedirect(308));
  assert.ok(!isPermanentRedirect(302) && !isPermanentRedirect(307));
  assert.equal(statusText(404), 'Not Found');
  assert.equal(statusText(799), 'Unknown status');
});

test('describeError gives friendly labels', () => {
  const err = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
  assert.match(describeError(err).label, /DNS lookup failed/);
});
