import { createReadStream } from 'node:fs';
import readline from 'node:readline';

/**
 * Turn user input into a clean, validated absolute URL.
 * Returns { url } on success or { error } with a reason.
 */
export function normalizeUrl(raw) {
  let text = String(raw).trim();
  if (!text) return { error: 'empty' };
  if (/\s/.test(text)) return { error: 'contains spaces' };

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`; // "example.com" -> https

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { error: 'not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `unsupported protocol "${parsed.protocol}" (only http and https)` };
  }
  if (!parsed.hostname) return { error: 'missing host name' };

  parsed.hash = ''; // fragments are never sent to the server
  return { url: parsed.href };
}

/**
 * Read lines from any readable stream (file or stdin), one at a time,
 * so even a file with a million URLs never has to fit in memory at once.
 */
export async function readEntries(stream, source = 'input') {
  const entries = [];
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;
    const text = line.split(/\s+#/)[0].trim(); // strip trailing "  # comment"
    if (!text || text.startsWith('#')) continue;
    entries.push({ text, source, line: lineNumber });
  }
  return entries;
}

export function readEntriesFromFile(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  return readEntries(stream, filePath);
}

/** Validate entries, drop duplicates and collect problems. */
export function prepareUrls(entries) {
  const seen = new Set();
  const urls = [];
  const invalid = [];
  let duplicates = 0;

  for (const entry of entries) {
    const { url, error } = normalizeUrl(entry.text);
    if (error) {
      invalid.push({ ...entry, reason: error });
    } else if (seen.has(url)) {
      duplicates += 1;
    } else {
      seen.add(url);
      urls.push(url);
    }
  }
  return { urls, invalid, duplicates };
}
