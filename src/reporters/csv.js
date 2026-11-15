import { sortBySeverity } from '../summary.js';

const HEADER = [
  'url',
  'category',
  'status',
  'status_text',
  'response_time_ms',
  'slow',
  'redirect_count',
  'permanent_redirect',
  'final_url',
  'method',
  'attempts',
  'error_code',
  'error_message',
  'checked_at',
];

/** Quote a field when it contains a comma, quote or line break (RFC 4180). */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Stop spreadsheet formula injection: =, +, -, @ at the start of a cell.
  if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A generator: yields one CSV line at a time so it can be streamed to disk. */
export function* csvLines(report) {
  yield `${HEADER.join(',')}\n`;
  for (const r of sortBySeverity(report.results)) {
    const row = [
      r.url,
      r.category,
      r.status,
      r.statusText,
      r.responseTime,
      r.slow,
      r.redirectCount,
      r.permanentRedirect,
      r.finalUrl,
      r.method,
      r.attempts,
      r.error?.code,
      r.error?.message,
      r.checkedAt,
    ];
    yield `${row.map(csvField).join(',')}\n`;
  }
}
