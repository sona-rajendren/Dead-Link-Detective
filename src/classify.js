import { STATUS_CODES } from 'node:http';

/** The four outcomes a checked link can have. "Slow" is a separate flag. */
export const CATEGORY = Object.freeze({
  OK: 'ok',
  REDIRECT: 'redirect',
  BROKEN: 'broken',
  ERROR: 'error',
});

export function statusText(code) {
  return STATUS_CODES[code] ?? 'Unknown status';
}

/** 301 and 308 tell clients (and search engines) the move is permanent. */
export function isPermanentRedirect(code) {
  return code === 301 || code === 308;
}

/**
 * Decide the category of one finished check.
 *   error    - no usable HTTP answer (DNS failure, timeout, TLS error, redirect loop...)
 *   broken   - the server answered with 4xx or 5xx
 *   redirect - one or more redirects were followed (or a 3xx was returned)
 *   ok       - a clean 2xx answer
 */
export function classify({ status, redirectCount, error }) {
  if (error) return CATEGORY.ERROR;
  if (status >= 400) return CATEGORY.BROKEN;
  if (redirectCount > 0 || (status >= 300 && status < 400)) return CATEGORY.REDIRECT;
  return CATEGORY.OK;
}

const FRIENDLY_ERRORS = {
  ENOTFOUND: 'DNS lookup failed (domain does not exist)',
  EAI_AGAIN: 'DNS lookup failed (temporary)',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection reset by server',
  ETIMEOUT: 'Request timed out',
  EMAXREDIRECTS: 'Too many redirects',
  EREDIRECTLOOP: 'Redirect loop',
  EBADLOCATION: 'Invalid redirect target',
  CERT_HAS_EXPIRED: 'TLS certificate expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed TLS certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate cannot be verified',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate does not match the domain',
};

/** Turn a raw Node.js error into a short, readable label. */
export function describeError(error) {
  const code = error.code ?? error.name ?? 'UNKNOWN';
  return {
    code,
    label: FRIENDLY_ERRORS[code] ?? error.message ?? 'Unknown error',
    message: error.message,
  };
}
