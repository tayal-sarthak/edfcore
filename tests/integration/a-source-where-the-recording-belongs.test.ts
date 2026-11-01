/**
 * A source handed to the reading calls where the recording belongs.
 *
 * The source is what a caller builds first, and `readRecordBytes(source, header, records)` takes
 * it as the first argument — so `readWindow(source, window)` is the same reach one layer up. It
 * was called "an object, not the object openEdf() returns", which does not say which object.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

describe('a ByteSource passed as the recording', () => {
  it.each([
    [
      'readWindow',
      (r: unknown) =>
        readWindow(r as never, { signalIndices: [0], startSeconds: 0, durationSeconds: 1 }),
    ],
    [
      'readRecords',
      (r: unknown) =>
        readRecords(r as never, { signalIndices: [0], records: { start: 0, count: 1 } }),
    ],
    ['readAnnotations', (r: unknown) => readAnnotations(r as never, { start: 0, count: 1 })],
  ] as const)('%s() names it', async (name, call) => {
    await expect(call(byteSource(minimalEdf()))).rejects.toThrow(
      `${name}(): the recording is a ByteSource — what openEdf() reads, not what it resolves to. ` +
        'Next: pass `await openEdf(source)`.',
    );
  });
});
