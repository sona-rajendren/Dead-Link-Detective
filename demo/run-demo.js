/**
 * Runs the whole tool against the local misbehaving site.
 *   npm run demo
 * No internet needed. Reports are written to ./reports.
 */
import { DeadLinkDetective, TOOL } from '../src/detective.js';
import { createConsoleReporter } from '../src/reporters/console.js';
import { writeReports } from '../src/reporters/index.js';
import { prepareUrls } from '../src/urlList.js';
import { createColors, shouldUseColor } from '../src/utils/colors.js';
import { DEMO_PATHS, startMockServer } from './mockServer.js';

const mock = await startMockServer(Number(process.env.DEMO_PORT) || 0);
const entries = [
  ...DEMO_PATHS.map((p) => ({ text: `${mock.baseUrl}${p}`, source: 'demo', line: 0 })),
  { text: 'http://127.0.0.1:1/', source: 'demo', line: 0 }, // connection refused
  { text: 'http://no-such-domain-12345.invalid/', source: 'demo', line: 0 }, // DNS failure
];
const { urls } = prepareUrls(entries);

const ui = createConsoleReporter(createColors(shouldUseColor()));
const detective = new DeadLinkDetective({ concurrency: 10, timeout: 4000, slowThreshold: 1500, retries: 1 });
detective.on('start', ({ total, options }) => ui.header(TOOL.version, total, options));
detective.on('result', ({ result, done, total }) => ui.line(result, done, total));

const report = await detective.run(urls);
ui.summary(report);
ui.files(await writeReports(report, { outDir: 'reports' }));
await mock.close();
