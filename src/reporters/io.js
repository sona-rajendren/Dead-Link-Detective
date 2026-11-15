import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/**
 * Write a report to disk safely.
 *  - `data` can be a string (written in one go) or an iterable of chunks
 *    (streamed, so very large reports never sit fully in memory).
 *  - With `gzip: true` the file is compressed and gets a ".gz" suffix.
 *  - The file is first written to "<name>.tmp" and then renamed, so a crash
 *    can never leave a half-written report behind.
 * Returns the final path.
 */
export async function writeOutput(filePath, data, { gzip: compress = false } = {}) {
  const finalPath = compress ? `${filePath}.gz` : filePath;
  const tempPath = `${finalPath}.tmp`;
  await mkdir(path.dirname(finalPath), { recursive: true });

  try {
    if (typeof data === 'string') {
      await writeFile(tempPath, compress ? await gzipAsync(data) : data);
    } else {
      const source = Readable.from(data);
      const target = createWriteStream(tempPath);
      if (compress) await pipeline(source, createGzip(), target);
      else await pipeline(source, target);
    }
    await rename(tempPath, finalPath);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
  return finalPath;
}
