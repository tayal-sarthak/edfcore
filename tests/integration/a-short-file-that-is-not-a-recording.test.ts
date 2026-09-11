/**
 * `SOURCE_TOO_SMALL` on a file that is short because it is not a recording at all.
 *
 * A file shorter than the 256-byte fixed header never reaches `detectVariant`, which is where
 * the container is normally named — so a 76-byte zip, a gzip that failed to download, or an HTML
 * error page saved under an `.edf` name all earned the message written for a truncated
 * recording: "a transfer cut short and a truncated copy both land here, and neither leaves
 * anything to read." Two causes named, and the one the reader actually had excluded.
 *
 * The magic number is four bytes, so it is in hand even at 76. The refusal names the container
 * when the bytes say what it is, and keeps the size menu for when they do not — the same shape
 * 0.6.26 gave `NOT_AN_EDF_FILE` and 0.6.40 gave this code's empty/short split (fixed in 0.6.65).
 *
 * Both branches are exercised, because a message that named a container unconditionally would be
 * a worse defect than the one it replaced.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { truncate } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

const CONTAINERS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['a gzip', [0x1f, 0x8b]],
  ['a zip', [0x50, 0x4b, 0x03, 0x04]],
  ['a bzip2', [0x42, 0x5a, 0x68]],
  ['a zstd', [0x28, 0xb5, 0x2f, 0xfd]],
];

/** `magic`, then filler, in fewer bytes than the fixed header. */
function shortFile(magic: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(76).fill(0x41);
  bytes.set(magic, 0);
  return bytes;
}

/** The message `parseHeader` refuses these bytes with. */
function refusal(bytes: Uint8Array): string {
  try {
    parseHeader(bytes, bytes.length);
  } catch (error) {
    expect(isEdfError(error)).toBe(true);
    expect((error as { code?: string }).code).toBe('SOURCE_TOO_SMALL');
    return (error as Error).message;
  }
  throw new Error('those bytes were accepted');
}

describe('a short file whose first bytes name a container', () => {
  it.each(CONTAINERS)('names %s rather than a truncated download', (name, magic) => {
    const message = refusal(shortFile(magic));
    expect(message).toContain(`these bytes begin ${name}`);
    expect(message).not.toContain('a transfer cut short');
  });

  it('still reports the size, which is the finding', () => {
    expect(refusal(shortFile([0x50, 0x4b, 0x03, 0x04]))).toContain('the source is 76 bytes');
  });
});

describe('a short file that really is a truncated recording', () => {
  const REAL = truncate(
    buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    }),
    100,
  );

  it('keeps the menu, because the bytes say nothing about the cause', () => {
    const message = refusal(REAL);
    expect(message).toContain('a transfer cut short and a truncated copy both land here');
    expect(message).not.toContain('these bytes begin');
  });

  it('is not mistaken for a container by its own version block', () => {
    expect(readFileSync(new URL('../../src/header/variant.ts', import.meta.url), 'utf8')).toContain(
      'const CONTAINERS',
    );
  });
});

describe('an empty source', () => {
  it('is a different finding and keeps its own message', () => {
    expect(refusal(new Uint8Array(0))).toContain('the source is empty');
  });
});
