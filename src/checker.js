import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { callbackify } from 'node:util';

import { resolveOptions } from './config.js';
import { CATEGORY, classify, describeError, isPermanentRedirect, statusText } from './classify.js';

/** An error with a stable string code (like Node's own system errors). */
export class LinkCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LinkCheckError';
    this.code = code;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
// Timeouts are deliberately NOT retried: they already cost the full timeout.
const RETRYABLE_ERRORS = new Set(['ECONNRESET', 'EAI_AGAIN', 'EPIPE']);

/**
 * Send ONE HTTP(S) request and resolve as soon as the response headers
 * arrive. The body is never downloaded - we only care about the status line.
 * `responseTime` is therefore "time until the server answered".
 */
function singleRequest(url, { method, timeout, userAgent, insecure }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const started = performance.now();
    let settled = false;
    let timer;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const req = transport.request(
      url,
      {
        method,
        agent: false, // fresh socket per request; concurrency is controlled by our own pool
        rejectUnauthorized: !insecure,
        headers: {
          'user-agent': userAgent,
          accept: '*/*',
          'accept-encoding': 'identity',
        },
      },
      (res) => {
        const elapsed = performance.now() - started;
        settle(resolve, { status: res.statusCode, headers: res.headers, elapsed });
        res.destroy(); // discard the body, we have what we need
      },
    );

    // One hard deadline for the whole request (DNS + connect + TLS + first byte).
    timer = setTimeout(() => {
      const err = new LinkCheckError('ETIMEOUT', `No response within ${timeout} ms`);
      settle(reject, err);
      req.destroy(err);
    }, timeout);

    req.on('error', (err) => settle(reject, err));
    req.end();
  });
}

/**
 * Many servers reject HEAD (405/501) or answer it wrongly (403/404) even
 * though a normal GET works. To avoid false "broken" reports, any HEAD answer
 * of 400+ is double-checked with a GET before we believe it.
 */
async function requestWithFallback(url, options) {
  const first = await singleRequest(url, options);
  if (options.method === 'HEAD' && first.status >= 400) {
    const second = await singleRequest(url, { ...options, method: 'GET' });
    return { ...second, method: 'GET' };
  }
  return { ...first, method: options.method };
}

/**
 * One full attempt: request, follow redirects, record the chain.
 * Never throws - failures are returned inside the `error` field.
 */
async function attemptCheck(startUrl, options) {
  const redirects = [];
  const visited = new Set();
  let current = new URL(startUrl);
  let status = null;
  let method = options.method;
  let responseTime = 0;
  let error = null;
  const attemptStarted = performance.now();

  try {
    for (;;) {
      visited.add(current.href);
      const res = await requestWithFallback(current, options);
      status = res.status;
      method = res.method;
      responseTime += res.elapsed;

      const location = res.headers.location;
      if (!options.followRedirects || !REDIRECT_STATUSES.has(status) || !location) break;

      redirects.push({ url: current.href, status });
      if (redirects.length > options.maxRedirects) {
        throw new LinkCheckError('EMAXREDIRECTS', `More than ${options.maxRedirects} redirects`);
      }

      let next;
      try {
        next = new URL(location, current); // handles relative Location headers
      } catch {
        throw new LinkCheckError('EBADLOCATION', `Invalid Location header: ${location}`);
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new LinkCheckError('EBADLOCATION', `Unsupported redirect protocol: ${next.protocol}`);
      }
      if (visited.has(next.href)) {
        throw new LinkCheckError('EREDIRECTLOOP', `Redirect loop back to ${next.href}`);
      }
      current = next;
    }
  } catch (err) {
    error = err;
    responseTime = performance.now() - attemptStarted; // e.g. a timeout shows how long we waited
  }

  return { finalUrl: current.href, status, method, redirects, responseTime, error };
}

function shouldRetry(attempt) {
  if (attempt.error) return RETRYABLE_ERRORS.has(attempt.error.code);
  return RETRYABLE_STATUSES.has(attempt.status);
}

/**
 * Check a single URL and return a plain result object.
 * Promise-based, never rejects for network problems (they become results).
 */
export async function checkUrl(url, overrides = {}) {
  const options = resolveOptions(overrides);
  let attempt;
  let attempts = 0;

  for (let i = 0; i <= options.retries; i += 1) {
    attempts += 1;
    attempt = await attemptCheck(url, options);
    if (i === options.retries || !shouldRetry(attempt)) break;
    await sleep(options.retryDelay * 2 ** i); // exponential back-off
  }

  const { finalUrl, status, method, redirects, responseTime, error } = attempt;
  const described = error ? describeError(error) : null;
  const category = classify({ status, redirectCount: redirects.length, error });
  const rounded = Math.round(responseTime);

  return {
    id: createHash('sha1').update(url).digest('hex').slice(0, 10),
    url,
    finalUrl,
    status,
    statusText: status ? statusText(status) : null,
    category,
    slow: category !== CATEGORY.ERROR && rounded > options.slowThreshold,
    responseTime: rounded,
    redirectCount: redirects.length,
    redirects,
    permanentRedirect: redirects.some((hop) => isPermanentRedirect(hop.status)),
    method,
    attempts,
    error: described,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Callback-style version of checkUrl: checkUrlCallback(url, options, (err, result) => {})
 * Built with util.callbackify so the course's callback pattern is available too.
 */
export const checkUrlCallback = callbackify(checkUrl);
