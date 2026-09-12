/**
 * `readHeader` and `readRecordBytes`, the two functions `openEdf` is a wrapper over.
 *
 * `api-primitives.md` sends a reader who has outgrown the convenience layer to exactly these, and
 * neither checked its source. Both read a field off it on their first line, so `readHeader(bytes)` —
 * the same mistake 0.4.444 named `openEdf(bytes)` for, made one layer down by someone who has just
 * been told to drop a layer — came back as V8's `Cannot read properties of undefined (reading
 * 'byteLength')` (fixed in 0.6.105).
 *
 * `assertByteSource` is the whole fix: the refusal already exists, names the adapter the caller was
 * missing, and was reachable from one entry point out of three.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

/** The cast a JavaScript caller does not need to write. */
const asSource = (value: unknown) => value as ByteSource;

async function refusal(run: () => unknown): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('the argument was accepted');
}

describe('readHeader', () => {
  it.each([
    ['the bytes themselves', BYTES],
    ['missing', undefined],
    ['null', null],
    ['a path string', 'recording.edf'],
  ])('refuses %s with the message openEdf gives', async (_described, given) => {
    const error = await refusal(() => readHeader(asSource(given)));
    expect(error.message).toContain('a ByteSource is needed');
    expect(error.message).not.toContain('Cannot read properties');
    expect(isEdfError(error)).toBe(true);
  });

  it('gives a path string the same advice openEdf does', async () => {
    const { message } = await refusal(() => readHeader(asSource('recording.edf')));
    expect(message).toContain('that looks like a path');
    const fromOpen = await refusal(() => openEdf(asSource('recording.edf')));
    expect(message).toBe(fromOpen.message);
  });

  it('still reads a real source', async () => {
    expect((await readHeader(byteSource(BYTES))).recordCount).toBe(2);
  });
});

describe('readRecordBytes', () => {
  it('refuses the bytes before it looks at the record range', async () => {
    const header = await readHeader(byteSource(BYTES));
    const error = await refusal(() =>
      readRecordBytes(asSource(BYTES), header, { start: 0, count: 1 }),
    );
    expect(error.message).toContain('a ByteSource is needed');
  });

  it('still refuses a record range the file does not have', async () => {
    const source = byteSource(BYTES);
    const header = await readHeader(source);
    const error = await refusal(() => readRecordBytes(source, header, { start: 9, count: 1 }));
    expect(error.message).not.toContain('a ByteSource is needed');
    expect(isEdfError(error)).toBe(true);
  });

  it('still reads a real range', async () => {
    const source = byteSource(BYTES);
    const header = await readHeader(source);
    const bytes = await readRecordBytes(source, header, { start: 0, count: 1 });
    expect(bytes.byteLength).toBe(header.recordByteLength);
  });
});
