/**
 * `signalIndices`, in the one resolver that never checked it was a list.
 *
 * `assertSignalIndices` has refused a non-array on every sample read since 0.4.442 — "signalIndices
 * is a string, not an array of signal indices" — and `tal/annotations.ts` keeps its own copy of
 * that loop, for reasons its docblock sets out at length. The copy took the class of the refusals
 * and not the guard in front of them.
 *
 * A string is iterable, so the loop read the channels its CHARACTERS name:
 *
 *   - `'12'` on a file whose annotation signals are 1 and 2 returned every annotation in the file,
 *     to a caller who asked for one channel — and asking for one channel is the whole reason the
 *     option exists, since omitting it already reads them all;
 *   - `'1,2'` reached `header.signals[',']` and was refused as "signalIndex , is outside the 3
 *     signals this file declares", which names a signal index no caller wrote;
 *   - a plain number — the single index written when a file has one annotation channel — threw
 *     V8's "indices is not iterable".
 *
 * A string is how this option arrives. It is a field on an options object built from a query
 * string, a config file or a CLI argument, and 0.6.143 fixed the identical shape in `redactFields`,
 * the other option in this package that takes a list.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf, readAnnotations } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfHeader, EdfRecording } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const RECORDS = 4;

/** Two annotation signals, so a walked string can select a channel the caller did not name. */
const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.25, texts: [`e${r}`] }] },
    { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.5, texts: [`x${r}`] }] },
  ],
});

const RANGE = { start: 0, count: RECORDS } as const;

async function opened(): Promise<{
  recording: EdfRecording;
  header: EdfHeader;
  bytes: Uint8Array;
}> {
  const recording = await openEdf(byteSource(FILE));
  const bytes = await readRecordBytes(recording.source, recording.header, RANGE);
  return { recording, header: recording.header, bytes };
}

const decode = (header: EdfHeader, bytes: Uint8Array, signalIndices: unknown): unknown =>
  decodeAnnotations(header, bytes, RANGE, { signalIndices } as never);

describe.each([
  ['a string naming one channel', '1'],
  ['a string whose characters name two', '12'],
  ['a string with a separator in it', '1,2'],
  ['a plain number', 1],
  ['an array-like that is not an array', { 0: 1, length: 1 }],
])('signalIndices that is %s', (_name, signalIndices) => {
  it('is refused rather than iterated', async () => {
    const { header, bytes } = await opened();
    expect(() => decode(header, bytes, signalIndices)).toThrow(/not an array of signal indices/);
  });

  it('says what a string does, and never leaks an internal name', async () => {
    const { header, bytes } = await opened();
    try {
      decode(header, bytes, signalIndices);
      expect.unreachable('a signalIndices that is not a list must not be walked');
    } catch (error) {
      expect((error as Error).message).toContain('A string is iterable');
      expect((error as Error).message).toContain('Next:');
      expect((error as Error).message).not.toContain('not iterable');
    }
  });

  it('is refused through readAnnotations too, which forwards the option', async () => {
    const { recording } = await opened();
    await expect(readAnnotations(recording, RANGE, { signalIndices } as never)).rejects.toThrow(
      /not an array of signal indices/,
    );
  });
});

describe('the lists it does take', () => {
  it('still reads one named channel', async () => {
    const { header, bytes } = await opened();
    const result = decodeAnnotations(header, bytes, RANGE, { signalIndices: [1] });
    expect(result.annotations.map((a) => a.text)).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('still reads every annotation signal when the option is omitted', async () => {
    const { header, bytes } = await opened();
    expect(decodeAnnotations(header, bytes, RANGE).annotations).toHaveLength(2 * RECORDS);
  });

  it('still refuses an index this file does not have', async () => {
    const { header, bytes } = await opened();
    expect(() => decode(header, bytes, [9])).toThrow(/outside the 3 signals/);
  });

  it('still refuses a data channel', async () => {
    const { header, bytes } = await opened();
    expect(() => decode(header, bytes, [0])).toThrow(/is not an annotation signal/);
  });
});
