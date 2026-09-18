/**
 * `onProgress` given something that is not a function.
 *
 * It is the one option in this package that is a callback, and it exists on exactly the two calls
 * whose cost scales with the file — `types.ts` puts them at "long enough on a million-record
 * recording to want a progress bar".
 *
 * Both read it as `options?.onProgress?.(done, total)`. Optional-call syntax guards against ABSENCE
 * and not against a wrong kind, so a number or a string reached the call site and threw V8's
 * `options?.onProgress is not a function`: no `Next:` clause, naming an internal expression, from
 * inside a traversal that had already started reading.
 *
 * And whether it threw at all depended on the file, because the progress call sits in the scan loop.
 * A recording with nothing to scan finished cleanly with the bad option never touched. That is the
 * data-dependent guard 0.6.169 and 0.6.177 were each spent on, in the one option that is a function.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** Records to scan, so the loop the callback lives in actually runs. */
const WITH_RECORDS = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** No records at all, so the loop never runs and the old failure never arrived. */
const EMPTY = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 0,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

const NOT_A_FUNCTION: ReadonlyArray<readonly [string, unknown]> = [
  ['a number', 5],
  ['a string', 'onProgress'],
  ['true', true],
  ['an object', { call: () => {} }],
];

const CALLS: ReadonlyArray<
  readonly [string, (recording: EdfRecording, onProgress: unknown) => Promise<unknown>]
> = [
  [
    'validateRecording',
    (recording, onProgress) => validateRecording(recording, { onProgress } as never),
  ],
  [
    'buildRecordIndex',
    (recording, onProgress) => buildRecordIndex(recording, { onProgress } as never),
  ],
];

describe.each(CALLS)('%s', (_name, call) => {
  describe.each(NOT_A_FUNCTION)('given %s', (_shape, onProgress) => {
    it('is refused in edfcore’s own voice, with a next step', async () => {
      const recording = await opened(WITH_RECORDS);
      const thrown = await call(recording, onProgress).then(
        () => undefined,
        (error: unknown) => error as Error,
      );
      expect(thrown).toBeDefined();
      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect(thrown?.message).toContain('options.onProgress must be a function');
      expect(thrown?.message).toContain('Next:');
      expect(thrown?.message).not.toContain('is not a function.');
    });

    it('is refused on a file with nothing to scan, where the loop never ran', async () => {
      const recording = await opened(EMPTY);
      await expect(call(recording, onProgress)).rejects.toThrow(
        /options.onProgress must be a function/,
      );
    });
  });
});

describe('the callback itself', () => {
  it('is still called by validateRecording, with the records scanned and the total', async () => {
    const seen: Array<[number, number]> = [];
    await validateRecording(await opened(WITH_RECORDS), {
      scanSamples: true,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toEqual([6, 6]);
  });

  it('is still called by buildRecordIndex', async () => {
    const seen: Array<[number, number]> = [];
    await buildRecordIndex(await opened(WITH_RECORDS), {
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.length).toBeGreaterThan(0);
  });

  it('is still optional, and explicitly undefined is still no callback', async () => {
    await expect(validateRecording(await opened(WITH_RECORDS))).resolves.toBeDefined();
    await expect(
      buildRecordIndex(await opened(WITH_RECORDS), { onProgress: undefined } as never),
    ).resolves.toBeDefined();
  });
});
