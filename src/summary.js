import { CATEGORY } from './classify.js';

const SEVERITY = { [CATEGORY.ERROR]: 0, [CATEGORY.BROKEN]: 1, [CATEGORY.REDIRECT]: 2, [CATEGORY.OK]: 3 };

/** Worst problems first; inside a group, slowest first. */
export function sortBySeverity(results) {
  return [...results].sort((a, b) => {
    const bySeverity = SEVERITY[a.category] - SEVERITY[b.category];
    if (bySeverity !== 0) return bySeverity;
    if (a.slow !== b.slow) return a.slow ? -1 : 1;
    return b.responseTime - a.responseTime;
  });
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

/** Aggregate numbers shown at the top of every report. */
export function summarize(results) {
  const total = results.length;
  const count = (category) => results.filter((r) => r.category === category).length;

  const byStatus = {};
  for (const r of results) {
    const key = r.error ? 'ERR' : r.status;
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const times = results.filter((r) => !r.error).map((r) => r.responseTime).sort((a, b) => a - b);
  const sum = times.reduce((acc, n) => acc + n, 0);
  const slowest = results.reduce((max, r) => (r.responseTime > (max?.responseTime ?? -1) ? r : max), null);

  const broken = count(CATEGORY.BROKEN);
  const errors = count(CATEGORY.ERROR);

  return {
    total,
    ok: count(CATEGORY.OK),
    redirects: count(CATEGORY.REDIRECT),
    broken,
    errors,
    slow: results.filter((r) => r.slow).length,
    permanentRedirects: results.filter((r) => r.permanentRedirect).length,
    byStatus,
    avgResponseTime: times.length ? Math.round(sum / times.length) : 0,
    p95ResponseTime: percentile(times, 95),
    slowest: slowest ? { url: slowest.url, responseTime: slowest.responseTime } : null,
    healthScore: total ? Math.round(((total - broken - errors) / total) * 100) : 100,
  };
}
