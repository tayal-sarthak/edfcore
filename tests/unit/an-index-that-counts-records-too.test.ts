/**
 * `declaredDurationSeconds` given the record index.
 *
 * 0.6.108 gave this function a guard, because it "is the one function here whose name says
 * RECORDING, and `declaredDurationSeconds` is the sort of thing a reader asks of one". It tests
 * `Number.isInteger(header.recordCount)`, and it names two other objects in its `Next:` clause —
 * `recording.header`, and `timeline.spanSeconds` "for the span of a discontinuous file".
 *
 * `EdfRecordIndex` counts records as well, so it walked past that check. It has no
 * `recordDurationTicks`, so `BigInt(recordCount) * undefined` answered "Cannot mix BigInt and other
 * types, use explicit conversions" — a near-miss of the message 0.6.108 removed, from the same
 * guard, one neighbour over. The index is also what a reader has in hand after `buildRecordIndex`,
 * which is the call this function's own advice is pointing them toward.
 *
 * The TIMELINE is deliberately still accepted, and `the-last-two-unchecked-arguments.test.ts`
 * records why: it declares both fields with the same meanings, so the arithmetic is the header's
 * arithmetic and the answer is the header's answer. This checks the missing FIELD rather than the
 * type, which is what leaves that decision standing.
 */

import { describe, expect, it } from 'vitest';
import { declaredDurationSeconds } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 4;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

describe('the record index', () => {
  it('counts records, which is why it reached the multiplication', async () => {
    const recording = await opened();
    expect(Number.isInteger(recording.index.recordCount)).toBe(true);
    expect(
      (recording.index as unknown as Record<string, unknown>).recordDurationTicks,
    ).toBeUndefined();
  });

  it('is refused rather than dying on the multiplication', async () => {
    const recording = await opened();
    // Probed and complete alike: `buildRecordIndex` resolves to the index itself.
    for (const index of [recording.index, await buildRecordIndex(recording)]) {
      let thrown: Error | undefined;
      try {
        declaredDurationSeconds(index as never);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect(thrown?.message).not.toContain('Cannot mix BigInt');
      expect(thrown?.message).toContain('declares no recordDurationTicks');
      expect(thrown?.message).toContain('Next: pass recording.header');
    }
  });

  it('is still sent on to the span, which is what a reader reaching for it usually wants', async () => {
    const recording = await opened();
    expect(() => declaredDurationSeconds(recording.index as never)).toThrow(
      /timeline\.spanSeconds/,
    );
  });
});

describe('the arguments that already worked', () => {
  it('still answer for a real header', async () => {
    expect(declaredDurationSeconds((await opened()).header)).toBe(RECORDS);
  });

  it('still accept the timeline, which is a recorded decision rather than an oversight', async () => {
    const recording = await opened();
    expect(declaredDurationSeconds(recording.timeline as never)).toBe(
      declaredDurationSeconds(recording.header),
    );
  });

  it('keep the 0.6.108 refusal for a recording, which counts no records', async () => {
    const recording = await opened();
    expect(() => declaredDurationSeconds(recording as never)).toThrow(/it has no recordCount/);
  });
});
