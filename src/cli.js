#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { DeadLinkDetective, TOOL } from './detective.js';
import { createConsoleReporter } from './reporters/console.js';
import { FORMATS, writeReports } from './reporters/index.js';
import { startReportServer } from './server.js';
import { prepareUrls, readEntries, readEntriesFromFile } from './urlList.js';
import { createColors, shouldUseColor } from './utils/colors.js';

const HELP = `
Dead Link Detective v${TOOL.version}
Finds broken links before your users do.

USAGE
  dead-link-detective check <file|url> [more files or urls] [options]
  dead-link-detective serve [options]
  cat urls.txt | dead-link-detective check -

CHECK OPTIONS
  -c, --concurrency <n>     Requests in flight at once            (default 10)
      --per-host <n>        Max simultaneous requests per host    (default 3)
  -t, --timeout <ms>        Give up on a request after            (default 8000)
  -s, --slow <ms>           Flag responses slower than            (default 1500)
  -r, --retries <n>         Retries for transient failures        (default 1)
      --max-redirects <n>   Redirect hops to follow               (default 5)
      --method <HEAD|GET>   First request method                 (default HEAD)
      --no-redirects        Report 3xx answers instead of following them
      --insecure            Accept invalid TLS certificates
  -f, --format <list>       json,csv,html                         (default all three)
  -o, --out <dir>           Report folder                         (default ./reports)
      --gzip                Compress report files (.gz)
      --no-report           Do not write report files
  -q, --quiet               Only show the summary
      --fail-on-broken      Exit with code 1 if any link is broken or failing
      --no-color            Disable coloured output

SERVE OPTIONS
  -p, --port <n>            Port                                  (default 3000)
  -o, --out <dir>           Report folder to publish              (default ./reports)

OTHER
  -h, --help                Show this help
  -v, --version             Show the version

EXIT CODES
  0 finished   1 broken links found (with --fail-on-broken)   2 usage or runtime error
`;

const OPTIONS = {
  concurrency: { type: 'string', short: 'c' },
  'per-host': { type: 'string' },
  timeout: { type: 'string', short: 't' },
  slow: { type: 'string', short: 's' },
  retries: { type: 'string', short: 'r' },
  'max-redirects': { type: 'string' },
  method: { type: 'string' },
  'no-redirects': { type: 'boolean' },
  insecure: { type: 'boolean' },
  format: { type: 'string', short: 'f' },
  out: { type: 'string', short: 'o', default: 'reports' },
  gzip: { type: 'boolean' },
  'no-report': { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  'fail-on-broken': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  port: { type: 'string', short: 'p', default: '3000' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

class UsageError extends Error {}

function toInt(name, value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`--${name} expects a whole number (got "${value}")`);
  return Number(value);
}

/** Positional arguments can be files, "-" (stdin) or URLs. */
async function collectEntries(inputs) {
  const entries = [];
  for (const input of inputs) {
    if (input === '-') {
      entries.push(...(await readEntries(process.stdin, 'stdin')));
    } else if (existsSync(input)) {
      entries.push(...(await readEntriesFromFile(input)));
    } else if (/^https?:\/\//i.test(input)) {
      entries.push({ text: input, source: 'argument', line: 1 });
    } else if (/\.(txt|csv|list|urls|md)$/i.test(input) || /[\\/]/.test(input) && !input.includes('.')) {
      throw new UsageError(`File not found: ${input}`);
    } else if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(input)) {
      entries.push({ text: input, source: 'argument', line: 1 }); // bare domain such as example.com
    } else {
      throw new UsageError(`"${input}" is neither an existing file nor a URL.`);
    }
  }
  return entries;
}

async function runCheck(values, inputs) {
  const colors = createColors(shouldUseColor(process.stdout, values['no-color']));
  const ui = createConsoleReporter(colors);

  const formats = values.format ? values.format.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean) : FORMATS;
  const bad = formats.filter((f) => !FORMATS.includes(f));
  if (bad.length) throw new UsageError(`Unknown format "${bad.join(', ')}". Choose from: ${FORMATS.join(', ')}`);

  if (inputs.length === 0) {
    if (process.stdin.isTTY) throw new UsageError('Give me a file or URLs to check. Example: dead-link-detective check urls.txt');
    inputs = ['-']; // piped input
  }

  const { urls, invalid, duplicates } = prepareUrls(await collectEntries(inputs));
  if (urls.length === 0) throw new UsageError('No valid URLs found to check.');

  const detective = new DeadLinkDetective({
    concurrency: toInt('concurrency', values.concurrency),
    perHost: toInt('per-host', values['per-host']),
    timeout: toInt('timeout', values.timeout),
    slowThreshold: toInt('slow', values.slow),
    retries: toInt('retries', values.retries),
    maxRedirects: toInt('max-redirects', values['max-redirects']),
    method: values.method,
    followRedirects: !values['no-redirects'],
    insecure: values.insecure,
  });

  detective.on('start', ({ total, options }) => ui.header(TOOL.version, total, options));
  if (!values.quiet) detective.on('result', ({ result, done, total }) => ui.line(result, done, total));
  else if (process.stdout.isTTY) {
    detective.on('result', ({ done, total }) => process.stdout.write(`\rChecked ${done}/${total}`));
    detective.on('done', () => process.stdout.write('\r\u001b[K'));
  }

  // Ctrl+C: stop scheduling new checks, then still write a partial report.
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log(colors.yellow('\nStopping... finishing in-flight requests (press Ctrl+C again to quit now)'));
    detective.stop();
  });

  const report = await detective.run(urls);
  ui.summary(report, invalid, duplicates);

  if (!values['no-report'] && report.results.length > 0) {
    ui.files(await writeReports(report, { outDir: values.out, formats, gzip: values.gzip }));
  }

  const failing = report.summary.broken + report.summary.errors;
  return values['fail-on-broken'] && failing > 0 ? 1 : 0;
}

async function runServe(values) {
  const port = toInt('port', values.port);
  const server = await startReportServer({ dir: values.out, port });
  const { port: actual } = server.address();
  console.log(`Serving the latest report from ${path.resolve(values.out)}`);
  console.log(`  Dashboard   http://localhost:${actual}/`);
  console.log(`  API         http://localhost:${actual}/api/results?category=broken`);
  console.log('Press Ctrl+C to stop.');

  await new Promise((resolve) => {
    process.once('SIGINT', () => server.close(resolve));
    process.once('SIGTERM', () => server.close(resolve));
  });
  return 0;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const { values, positionals } = parsed;

  if (values.help) return console.log(HELP), 0;
  if (values.version) return console.log(TOOL.version), 0;

  let [command, ...rest] = positionals;
  if (command !== 'check' && command !== 'serve') {
    rest = positionals; // allow shorthand: dead-link-detective urls.txt
    command = positionals.length === 0 ? 'help' : 'check';
  }
  if (command === 'help') return console.log(HELP), 0;
  return command === 'serve' ? runServe(values) : runCheck(values, rest);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (err instanceof UsageError || err instanceof RangeError) {
      console.error(`Error: ${err.message}\nRun with --help for usage.`);
    } else if (err.code === 'ENOENT' || err.code === 'EACCES') {
      console.error(`File error: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 2;
  },
);
