import path from 'node:path';

import { csvLines } from './csv.js';
import { renderHtml } from './html.js';
import { writeOutput } from './io.js';
import { renderJson } from './json.js';

export const FORMATS = ['json', 'csv', 'html'];

const pad = (n) => String(n).padStart(2, '0');

/** report-2026-11-15_14-05-09 (local time, sorts alphabetically = chronologically) */
export function timestampName(date = new Date()) {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `report-${d}_${t}`;
}

/**
 * Write the report in every requested format and return the file paths.
 * The three formats are written in parallel with Promise.all.
 */
export async function writeReports(report, { outDir = 'reports', formats = FORMATS, gzip = false, baseName } = {}) {
  const name = baseName ?? timestampName(new Date(report.generatedAt));
  const unknown = formats.filter((f) => !FORMATS.includes(f));
  if (unknown.length) throw new RangeError(`Unknown report format: ${unknown.join(', ')} (use ${FORMATS.join(', ')})`);

  const jobs = formats.map((format) => {
    const file = path.join(outDir, `${name}.${format}`);
    const data = { json: () => renderJson(report), csv: () => csvLines(report), html: () => renderHtml(report) }[format]();
    return writeOutput(file, data, { gzip });
  });
  return Promise.all(jobs);
}
