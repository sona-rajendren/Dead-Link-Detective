/**
 * Concurrency helpers built only on Promises.
 */

/**
 * Run `worker(item, index)` for every item, with at most `concurrency`
 * workers active at the same time. Results keep the order of the input.
 *
 * Instead of starting everything at once (which would open thousands of
 * sockets), we start N "lanes". Each lane repeatedly takes the next unclaimed
 * item until none are left.
 */
export async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;

  async function lane() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const laneCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: laneCount }, lane));
  return results;
}

/**
 * A counting semaphore: allows at most `limit` holders at once.
 * Used to limit simultaneous requests per host so we never hammer one server.
 */
export class Semaphore {
  #free;
  #waiting = [];

  constructor(limit) {
    this.#free = limit;
  }

  acquire() {
    return new Promise((resolve) => {
      let released = false;
      const grant = () =>
        resolve(() => {
          if (released) return; // releasing twice is harmless
          released = true;
          this.#release();
        });

      if (this.#free > 0) {
        this.#free -= 1;
        grant();
      } else {
        this.#waiting.push(grant);
      }
    });
  }

  #release() {
    const next = this.#waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else this.#free += 1;
  }
}
