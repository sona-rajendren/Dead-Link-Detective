import path from 'node:path';

import { sortBySeverity } from '../summary.js';

const trim = (text, max) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Same site -> show just the path ("/new-page"); other site -> full address. */
function shortTarget(finalUrl, originalUrl, max) {
  try {
    const a = new URL(finalUrl);
    const b = new URL(originalUrl);
    if (a.origin === b.origin) return trim(`${a.pathname}${a.search}`, max);
  } catch {
    /* fall through */
  }
  return trim(finalUrl, max);
}

/** Builds the coloured terminal output. Pure formatting, no logic about checking. */
export function createConsoleReporter(c, { out = (line) => console.log(line) } = {}) {
  const symbol = { ok: c.green('\u2714'), redirect: c.blue('\u279c'), broken: c.red('\u2716'), error: c.magenta('\u2716') };
  const paint = { ok: c.green, redirect: c.blue, broken: c.red, error: c.magenta };

  return {
    header(version, total, o) {
      out(c.bold(`Dead Link Detective v${version}`));
      out(
        c.gray(
          `Checking ${total} URL${total === 1 ? '' : 's'}  |  concurrency ${o.concurrency}  |  per host ${o.perHost}  |  timeout ${o.timeout} ms  |  slow > ${o.slowThreshold} ms`,
        ),
      );
      out('');
    },

    line(result, done, total) {
      const width = String(total).length;
      const counter = c.gray(`[${String(done).padStart(width)}/${total}]`);
      const code = paint[result.category](String(result.error ? 'ERR' : result.status).padEnd(3));
      const time = c.gray(`${String(result.responseTime).padStart(5)} ms`);
      let note = '';
      if (result.error) note = c.magenta(`  ${result.error.label}`);
      else if (result.redirectCount > 0) {
        const hops = `${result.redirectCount} redirect${result.redirectCount === 1 ? '' : 's'}`;
        note = c.blue(`  \u2192 ${shortTarget(result.finalUrl, result.url, 48)} (${hops})`);
      } else if (result.status >= 400) note = c.red(`  ${result.statusText}`);
      if (result.slow) note += c.yellow('  SLOW');
      if (result.attempts > 1) note += c.gray(`  (${result.attempts} attempts)`);
      out(`${counter} ${symbol[result.category]} ${code} ${time}  ${trim(result.url, 60)}${note}`);
    },

    summary(report, invalid = [], duplicates = 0) {
      const s = report.summary;
      const row = (label, value, colour = (x) => x) => out(`  ${label.padEnd(18)}${colour(String(value))}`);
      out('');
      out(c.bold('Summary'));
      row('Checked', s.total);
      row('OK', s.ok, c.green);
      row('Redirects', s.redirects, c.blue);
      row('Broken (4xx/5xx)', s.broken, s.broken ? c.red : c.green);
      row('Errors', s.errors, s.errors ? c.magenta : c.green);
      row(`Slow (> ${report.options.slowThreshold} ms)`, s.slow, s.slow ? c.yellow : c.green);
      row('Link health', `${s.healthScore}%`, s.healthScore >= 95 ? c.green : s.healthScore >= 80 ? c.yellow : c.red);
      row('Avg / p95 time', `${s.avgResponseTime} ms / ${s.p95ResponseTime} ms`);
      row('Duration', `${(report.durationMs / 1000).toFixed(1)} s${report.interrupted ? ' (interrupted)' : ''}`);
      if (duplicates) row('Duplicates', `${duplicates} skipped`, c.gray);
      for (const bad of invalid) out(c.yellow(`  Skipped ${bad.source}:${bad.line} "${bad.text}" - ${bad.reason}`));

      const problems = sortBySeverity(report.results).filter((r) => r.category === 'error' || r.category === 'broken');
      if (problems.length) {
        out('');
        out(c.bold('Links to fix'));
        for (const r of problems) {
          const why = r.error ? r.error.label : `${r.status} ${r.statusText}`;
          out(`  ${paint[r.category](trim(why, 42).padEnd(42))} ${trim(r.url, 70)}`);
        }
      }
      const permanent = report.results.filter((r) => r.permanentRedirect);
      if (permanent.length) {
        out('');
        out(c.bold('Update these (permanent redirects)'));
        for (const r of permanent) out(`  ${trim(r.url, 50)} ${c.blue('\u2192')} ${shortTarget(r.finalUrl, r.url, 40)}`);
      }
    },

    files(paths) {
      out('');
      out(c.bold('Reports written'));
      for (const p of paths) {
        const rel = path.relative(process.cwd(), p);
        out(`  ${c.cyan(rel && !rel.startsWith('..') ? rel : p)}`);
      };
    },
  };
}
