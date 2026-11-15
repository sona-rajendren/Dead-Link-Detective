import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { normalizeUrl, prepareUrls, readEntries } from '../src/urlList.js';

test('normalizeUrl adds https and strips the fragment', () => {
  assert.equal(normalizeUrl('example.com').url, 'https://example.com/');
  assert.equal(normalizeUrl('http://a.com/x#top').url, 'http://a.com/x');
});

test('normalizeUrl rejects bad input', () => {
  assert.ok(normalizeUrl('').error);
  assert.ok(normalizeUrl('ftp://files.example.com').error);
  assert.ok(normalizeUrl('two words').error);
  assert.ok(normalizeUrl('http://').error);
});

test('readEntries skips blanks and comments, keeps line numbers', async () => {
  const input = Readable.from(['# header\n\nexample.com\n  b.com  # inline note\n']);
  const entries = await readEntries(input, 'test');
  assert.deepEqual(
    entries.map((e) => [e.text, e.line]),
    [['example.com', 3], ['b.com', 4]],
  );
});

test('prepareUrls de-duplicates and reports invalid lines', () => {
  const entries = ['a.com', 'https://a.com/', 'ftp://x.com', 'b.com'].map((text, i) => ({ text, source: 's', line: i + 1 }));
  const { urls, invalid, duplicates } = prepareUrls(entries);
  assert.deepEqual(urls, ['https://a.com/', 'https://b.com/']);
  assert.equal(duplicates, 1);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].line, 3);
});
