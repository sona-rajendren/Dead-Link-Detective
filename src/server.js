import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);

/** Newest report file with the given extension (".json" or ".html"), plain or gzipped. */
export async function findLatest(dir, extension) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const matches = names
    .filter((n) => n.startsWith('report-') && (n.endsWith(`.${extension}`) || n.endsWith(`.${extension}.gz`)))
    .sort(); // timestamps in the name make alphabetical order = time order
  const name = matches.at(-1);
  return name ? { file: path.join(dir, name), gzipped: name.endsWith('.gz') } : null;
}

async function loadJsonReport(dir) {
  const latest = await findLatest(dir, 'json');
  if (!latest) return null;
  let raw = await readFile(latest.file);
  if (latest.gzipped) raw = await gunzipAsync(raw);
  return JSON.parse(raw.toString('utf8'));
}

/**
 * Filter results using URL query parameters, e.g.
 *   /api/results?category=broken
 *   /api/results?status=4xx&q=docs&limit=10
 *   /api/results?slow=true&sort=time
 */
export function filterResults(results, params) {
  let list = results;

  const category = params.get('category');
  if (category) list = list.filter((r) => r.category === category);

  const status = params.get('status');
  if (status) {
    list = /^[1-5]xx$/i.test(status)
      ? list.filter((r) => r.status && String(r.status)[0] === status[0])
      : list.filter((r) => String(r.status ?? 'ERR') === status.toUpperCase());
  }

  if (params.get('slow') === 'true') list = list.filter((r) => r.slow);

  const q = params.get('q')?.toLowerCase();
  if (q) list = list.filter((r) => r.url.toLowerCase().includes(q) || r.finalUrl.toLowerCase().includes(q));

  if (params.get('sort') === 'time') list = [...list].sort((a, b) => b.responseTime - a.responseTime);

  const limit = Number.parseInt(params.get('limit') ?? '', 10);
  if (Number.isInteger(limit) && limit > 0) list = list.slice(0, limit);
  return list;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** Small read-only web server that publishes the newest report. */
export function createReportServer({ dir = 'reports' } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

      switch (url.pathname) {
        case '/': {
          const latest = await findLatest(dir, 'html');
          if (!latest) return sendJson(res, 404, { error: 'No HTML report yet. Run a check first.' });
          const body = await readFile(latest.file);
          const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length };
          if (latest.gzipped) headers['Content-Encoding'] = 'gzip';
          res.writeHead(200, headers);
          return res.end(req.method === 'HEAD' ? undefined : body);
        }
        case '/health':
          return sendJson(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
        case '/api/summary':
        case '/api/results': {
          const report = await loadJsonReport(dir);
          if (!report) return sendJson(res, 404, { error: 'No JSON report yet. Run a check first.' });
          if (url.pathname === '/api/summary') {
            return sendJson(res, 200, { generatedAt: report.generatedAt, durationMs: report.durationMs, ...report.summary });
          }
          const results = filterResults(report.results, url.searchParams);
          return sendJson(res, 200, { count: results.length, total: report.results.length, results });
        }
        default:
          return sendJson(res, 404, { error: `Unknown route ${url.pathname}`, routes: ['/', '/api/summary', '/api/results', '/health'] });
      }
    } catch (err) {
      return sendJson(res, 500, { error: 'Internal Server Error', detail: err.message });
    }
  });
}

export function startReportServer({ dir = 'reports', port = 3000, host = '127.0.0.1' } = {}) {
  const server = createReportServer({ dir });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
