import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';

import { checkUrl } from './checker.js';
import { resolveOptions } from './config.js';
import { Semaphore, runPool } from './pool.js';
import { summarize } from './summary.js';

export const TOOL = Object.freeze({ name: 'Dead Link Detective', version: '1.0.0' });

/**
 * Orchestrates a whole run. It is an EventEmitter so the command line, a test,
 * or any other program can react to progress without the core knowing about
 * the user interface.
 *
 *   'start'  ({ total, options })
 *   'result' ({ result, done, total })   after every single link
 *   'done'   (report)
 */
export class DeadLinkDetective extends EventEmitter {
  constructor(overrides = {}) {
    super();
    this.options = resolveOptions(overrides);
    this.stopped = false;
    this.hostGates = new Map();
  }

  /** Stop starting new checks (in-flight ones still finish). */
  stop() {
    this.stopped = true;
  }

  #gateFor(host) {
    if (!this.hostGates.has(host)) this.hostGates.set(host, new Semaphore(this.options.perHost));
    return this.hostGates.get(host);
  }

  async run(urls) {
    const startedAt = new Date();
    const t0 = performance.now();
    const total = urls.length;
    let done = 0;

    this.emit('start', { total, options: this.options });

    const settled = await runPool(
      urls,
      async (url) => {
        const release = await this.#gateFor(new URL(url).host).acquire();
        try {
          if (this.stopped) return null;
          const result = await checkUrl(url, this.options);
          done += 1;
          this.emit('result', { result, done, total });
          return result;
        } finally {
          release();
        }
      },
      this.options.concurrency,
    );

    const results = settled.filter(Boolean);
    const { userAgent, ...publicOptions } = this.options;
    const report = {
      tool: TOOL,
      generatedAt: startedAt.toISOString(),
      durationMs: Math.round(performance.now() - t0),
      interrupted: results.length < total,
      options: publicOptions,
      summary: summarize(results),
      results,
    };

    this.emit('done', report);
    return report;
  }
}
