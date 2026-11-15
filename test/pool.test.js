import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

import { Semaphore, runPool } from '../src/pool.js';

test('runPool never exceeds the concurrency limit and keeps input order', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);

  const results = await runPool(
    items,
    async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      return n * 2;
    },
    4,
  );

  assert.equal(peak, 4);
  assert.deepEqual(results, items.map((n) => n * 2));
});

test('runPool handles empty input and limits larger than the list', async () => {
  assert.deepEqual(await runPool([], async () => 1, 5), []);
  assert.deepEqual(await runPool([1, 2], async (n) => n, 50), [1, 2]);
});

test('Semaphore allows only `limit` holders at once', async () => {
  const gate = new Semaphore(2);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      const release = await gate.acquire();
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      release();
    }),
  );
  assert.equal(peak, 2);
});

test('Semaphore release is idempotent', async () => {
  const gate = new Semaphore(1);
  const release = await gate.acquire();
  release();
  release(); // must not hand out a second slot
  const first = await gate.acquire();
  let secondGranted = false;
  gate.acquire().then(() => { secondGranted = true; });
  await sleep(10);
  assert.equal(secondGranted, false);
  first();
});
