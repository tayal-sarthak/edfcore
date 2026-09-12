/**
 * `getStatusSignal` given the recording instead of its header.
 *
 * `undefined` is this function's answer — "a file having no Status channel is an ordinary fact about
 * the file, not an error" — and its first line reads `header.bytesPerSample`. So
 * `getStatusSignal(recording)`, the object a reader has in hand from the `openEdf` two lines above
 * the call, found `undefined`, took the not-a-BDF branch, and reported that a BDF+ file with a
 * Status channel has none.
 *
 * That is the worst place in the package for a silent answer. Every trigger in the recording then
 * reads as absent, and a missing event is indistinguishable from no events (fixed in 0.6.120).
 *
 * `contiguityOf` (0.6.91) and `formatStartTimeNaive` (0.6.110) are the same shape: a function whose
 * own answer includes the one a wrong argument produces.
 */

import { describe, expect, it } from 'vitest';
import { getStatusSignal } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** A BDF+ file that really does carry a Status channel, which is what makes the silence cost. */
const WITH_STATUS = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** A plain EDF, where `undefined` is the true answer and must stay one. */
const WITHOUT_STATUS = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  const outcome = (() => {
    try {
      return { ok: true as const, value: run() };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();
  if (outcome.ok) throw new Error(`accepted, and returned ${String(outcome.value)}`);
  return outcome.message;
}

describe('a file that has one', () => {
  it('reports it from the header', async () => {
    const recording = await openEdf(byteSource(WITH_STATUS));
    expect(getStatusSignal(recording.header)?.label.trim()).toBe('Status');
  });

  it('no longer reports none when handed the recording', async () => {
    const recording = await openEdf(byteSource(WITH_STATUS));
    const message = refusal(() => getStatusSignal(loosely<EdfHeader>(recording)));
    expect(message).toContain('getStatusSignal(): that is not a header');
    expect(message).toContain('Next: pass recording.header');
  });

  it('says why undefined is not available as a refusal', async () => {
    const recording = await openEdf(byteSource(WITH_STATUS));
    expect(refusal(() => getStatusSignal(loosely<EdfHeader>(recording)))).toContain(
      'undefined is what this function returns for a file with no Status channel',
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['the signal list rather than the header', 'signals'],
  ])('refuses %s', (_described, given) => {
    const value = given === 'signals' ? { length: 2 } : given;
    expect(refusal(() => getStatusSignal(loosely<EdfHeader>(value)))).toContain(
      'that is not a header',
    );
  });
});

describe('a file that has none', () => {
  it('still answers undefined, which is an ordinary fact about the file', async () => {
    const recording = await openEdf(byteSource(WITHOUT_STATUS));
    expect(getStatusSignal(recording.header)).toBeUndefined();
  });

  it('is told apart from the refusal, which is the whole point', async () => {
    const plain = await openEdf(byteSource(WITHOUT_STATUS));
    const bdf = await openEdf(byteSource(WITH_STATUS));
    expect(getStatusSignal(plain.header)).toBeUndefined();
    expect(() => getStatusSignal(loosely<EdfHeader>(bdf))).toThrow(RangeError);
  });
});
