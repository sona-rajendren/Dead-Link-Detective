/**
 * Default settings and option validation.
 * Every number is validated up-front so a typo such as "--timeout abc"
 * fails immediately with a clear message instead of misbehaving later.
 */
export const DEFAULTS = Object.freeze({
  concurrency: 10, // total requests in flight at once
  perHost: 3, // max simultaneous requests to a single host (politeness)
  timeout: 8000, // ms before a request is abandoned
  slowThreshold: 1500, // ms; responses slower than this are flagged "slow"
  maxRedirects: 5, // redirect hops followed before giving up
  retries: 1, // extra attempts for transient failures (502/503/504/429, resets)
  retryDelay: 300, // ms; doubled after each failed attempt
  method: 'HEAD', // HEAD first (cheap), automatic GET fallback on 4xx/5xx
  followRedirects: true,
  insecure: false, // true = accept invalid TLS certificates
  userAgent: 'DeadLinkDetective/1.0 (+https://github.com/your-username/dead-link-detective)',
});

const RULES = {
  concurrency: { min: 1, max: 200 },
  perHost: { min: 1, max: 50 },
  timeout: { min: 100, max: 120000 },
  slowThreshold: { min: 1, max: 120000 },
  maxRedirects: { min: 0, max: 20 },
  retries: { min: 0, max: 5 },
  retryDelay: { min: 0, max: 30000 },
};

export function resolveOptions(overrides = {}) {
  const options = { ...DEFAULTS };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) options[key] = value;
  }

  for (const [key, { min, max }] of Object.entries(RULES)) {
    const value = options[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`"${key}" must be a whole number between ${min} and ${max} (got ${value}).`);
    }
  }

  options.method = String(options.method).toUpperCase();
  if (!['HEAD', 'GET'].includes(options.method)) {
    throw new RangeError(`"method" must be HEAD or GET (got ${options.method}).`);
  }
  return options;
}
