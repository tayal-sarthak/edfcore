/**
 * A FINITE bound that stops being finite inside the conversion.
 *
 * `nan-seconds-reaches.test.ts` sweeps the same entry points for `NaN`, `Infinity` and `-Infinity`,
 * and states the premise this file extends: "`secondsToTicks` is the one place a caller's seconds
 * become the integers everything else works in... The resolver is not the guarantee. The guarantee
 * is that a `NaN` cannot get PAST it."
 *
 * There was a fourth value, and the guard let it through. A tick is 100 ns, so the resolver
 * multiplies by ten million — and above about 1.8e301 seconds that product is `Infinity` for an
 * argument `Number.isFinite` accepted. `Math.round(Infinity)` is `Infinity`, and `BigInt(Infinity)`
 * is V8's
 *
 *     RangeError: The number Infinity cannot be converted to a BigInt because it is not an integer
 *
 * which breaks the contract `AGENTS.md` states for this package — "Every thrown message ends with a
 * `Next:` clause" — names an internal conversion the caller never mentioned, and says "is not an
 * integer" about a value they never produced. It escaped on eleven public calls.
 *
 * `Number.MAX_VALUE` is how it arrives, and the package teaches the reach for it. `api-primitives.md`
 * documents `maxItems` as "`Infinity` means no cap", so a sentinel for "all of it" is the idiom
 * here — and `Infinity` on a time bound is refused by the finiteness check with advice to go and
 * audit the expression that produced it, which leaves `Number.MAX_VALUE` as the next thing a caller
 * tries. That was the one that escaped.
 *
 * It never needed a sentinel: a duration past the end of the recording is CLAMPED to it, which the
 * last test here pins. That is what the advice says, rather than naming a window — the resolver's
 * own docblock records what caller-specific advice costs from one shared helper, the old wording
 * being "right for five of the fifteen call sites and wrong for the rest" (0.6.287).
 */

import { describe, expect, it } from 'vitest';
import { annotationsAt, filterAnnotationsByTime } from '../../src/annotations-query.js';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { gridSampleIndexAt } from '../../src/sample-grid.js';
import { sampleAt } from '../../src/sample-locate.js';
import { streamRecords } from '../../src/stream.js';
import { secondsToTicks } from '../../src/tal/ticks.js';
import { resolveTimeWindow, trimToWindow } from '../../src/time/window.js';
import { buildEdf } from '../support/writer.js';

/**
 * `Number.MAX_VALUE / 1e7` is about 1.7976931348623158e301, so the first of these converts and the
 * second overflows. Both are finite, which is the whole point.
 */
const CONVERTS = 1.79e301;
const OVERFLOWS = [Number.MAX_VALUE, -Number.MAX_VALUE, 1.8e301] as const;

const EDF_PLUS = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 24,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', texts: ['e'] }] : []),
    },
  ],
});

const BDF_WITH_STATUS = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

async function drivers(): Promise<ReadonlyArray<readonly [string, (seconds: number) => unknown]>> {
  const recording = await openEdf(byteSource(EDF_PLUS));
  const bdf = await openEdf(byteSource(BDF_WITH_STATUS));
  const index = await buildRecordIndex(recording);
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 4 },
    signalIndices: [0],
  });
  const series = chunk.signals[0];
  const signal = recording.header.signals[0];
  if (series === undefined || signal === undefined) throw new Error('fixture is not as expected');
  const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });

  return [
    [
      'readWindow (startSeconds)',
      (s) => readWindow(recording, { startSeconds: s, durationSeconds: 1, signalIndices: [0] }),
    ],
    [
      'readWindow (durationSeconds)',
      (s) => readWindow(recording, { startSeconds: 0, durationSeconds: s, signalIndices: [0] }),
    ],
    [
      'streamRecords',
      async (s) => {
        for await (const piece of streamRecords(recording, {
          startSeconds: s,
          durationSeconds: 1,
          signalIndices: [0],
        }))
          void piece;
      },
    ],
    [
      'readEnvelope',
      (s) =>
        readEnvelope(recording, {
          startSeconds: s,
          durationSeconds: 1,
          buckets: 4,
          signalIndices: [0],
        }),
    ],
    [
      'readEnvelopeAtResolution (secondsPerBucket)',
      (s) =>
        readEnvelopeAtResolution(recording, {
          startSeconds: 0,
          durationSeconds: 1,
          secondsPerBucket: s,
          signalIndices: [0],
        }),
    ],
    ['readTriggers', (s) => readTriggers(bdf, { startSeconds: s, durationSeconds: 1 })],
    ['resolveTimeWindow', (s) => resolveTimeWindow(recording.timeline, recording.index, s, 1)],
    ['trimToWindow (startSeconds)', (s) => trimToWindow(recording.header, series, s, 1)],
    ['trimToWindow (durationSeconds)', (s) => trimToWindow(recording.header, series, 0, s)],
    ['sampleAt', (s) => sampleAt(recording, 0, s)],
    [
      'gridSampleIndexAt',
      (s) => gridSampleIndexAt(signal, s, recording.header.recordDurationTicks),
    ],
    ['segmentAt', (s) => segmentAt(index, s)],
    ['gapAt', (s) => gapAt(index, s)],
    ['index.locate', (s) => index.locate(s)],
    [
      'filterAnnotationsByTime',
      (s) => filterAnnotationsByTime(annotations, { startSeconds: s, durationSeconds: 1 }),
    ],
    ['annotationsAt', (s) => annotationsAt(annotations, s)],
    ['secondsToTicks', (s) => secondsToTicks(s, 'seconds')],
  ];
}

const settle = async (drive: () => unknown): Promise<unknown> =>
  Promise.resolve()
    .then(drive)
    .then(
      () => undefined,
      (error: unknown) => error,
    );

describe('a bound too large to be a tick count', () => {
  it('is finite, so the check above the conversion accepts it', () => {
    for (const value of OVERFLOWS) {
      expect(Number.isFinite(value)).toBe(true);
      // And this is what it became. The premise of the whole file.
      expect(Number.isFinite(value * 10000000)).toBe(false);
    }
    expect(Number.isFinite(CONVERTS * 10000000)).toBe(true);
  });

  it.each(OVERFLOWS)(
    'is refused in edfcore’s own words, at every entry point, for %s',
    async (value) => {
      for (const [label, drive] of await drivers()) {
        const thrown = await settle(() => drive(value));

        expect(thrown, label).toBeInstanceOf(RangeError);
        const error = thrown as RangeError;
        // A caller mistake, not a file defect — the split `isEdfError` documents.
        expect(isEdfError(error), label).toBe(false);
        expect(error.message, label).toMatch(/Next:/);
        expect(error.message, label).toContain(String(value));
        // The defect itself: V8's conversion message, which has none of the above.
        expect(error.message, label).not.toContain('converted to a BigInt');
      }
    },
  );

  it('still converts the largest bound that has a tick count', async () => {
    // One ULP band below the overflow. The guard must refuse what cannot convert and nothing more.
    expect(secondsToTicks(CONVERTS, 'seconds')).toBe(BigInt(Math.round(CONVERTS * 10000000)));
    expect(await settle(() => annotationsAt([], CONVERTS))).toBeUndefined();
  });

  it('names the sentinel rather than a window, because fifteen call sites share the resolver', () => {
    const message = (secondsToTicks as (s: number, n: string) => bigint).bind(null);
    const thrown = (() => {
      try {
        message(Number.MAX_VALUE, 'secondsPerBucket');
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    // The caller's own argument name, and advice that is true for a bucket width as well as a window.
    expect(thrown).toContain('secondsPerBucket is 1.7976931348623157e+308 seconds');
    expect(thrown).toContain('sentinel');
    expect(thrown).not.toContain('window');
  });

  it('never needed a sentinel: a duration past the end is clamped to the recording', async () => {
    const recording = await openEdf(byteSource(EDF_PLUS));
    const asked = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 1e6,
      signalIndices: [0],
    });
    // Four one-second records, and a request for eleven days returns exactly those four.
    expect(asked[0]?.records).toEqual({ start: 0, count: 4 });
    expect(asked[0]?.durationSeconds).toBe(4);
  });
});
