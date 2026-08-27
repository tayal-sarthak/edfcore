/**
 * `inspectEdf` never throws about content, over bytes nobody chose.
 *
 * It is the triage call — "the right first call for an unfamiliar file" — and it makes the
 * strongest promise in the package. `openEdf` and `parseHeader` promise to throw an `EdfError`
 * rather than escape the error model, and `fuzz.test.ts` holds them to that over flipped, random
 * and truncated bytes. `inspectEdf` promises more: it does not throw at all. A caller drops a file
 * on a page and gets a report, whatever the file is.
 *
 * That promise has only ever been tested against fixtures somebody wrote. A promise of the form
 * "never, for any input" is exactly the kind a fixture cannot establish, because the inputs a
 * person thinks of are the inputs already handled — the four defects the fuzzing found during
 * development were all of that shape.
 *
 * The distinction the promise turns on is content against I/O: `inspectEdf` "does not throw about
 * *content*, and it does not hide I/O". Every source here is an in-memory byte array, so nothing
 * can fail except on what the bytes say — which makes any rejection a broken promise rather than
 * an ambiguous one.
 *
 * The report is checked as well as the call. "Never returns believable garbage" is the fourth
 * clause of the safety invariant, and a triage report full of `NaN` would satisfy "did not throw"
 * while telling a reader nothing true.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdfPlus } from '../support/writer.js';

/** Reproducible, and printed by fast-check on a failure. */
const SEED = 0x15ec7;

/** A well-formed file to damage, and the shape most real ones have. */
const VALID = minimalEdfPlus({
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 16 },
    { label: 'Resp', samplesPerRecord: 4 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/**
 * How many reports came back carrying a header. The consistency claims below all sit behind
 * `header !== undefined`, and damaged bytes reach that branch far less often than they reach the
 * call — so the count is asserted at the end rather than assumed.
 */
let headersReported = 0;

/** Everything the report says, checked for shapes a reader could believe and should not. */
function assertBelievable(inspection: Awaited<ReturnType<typeof inspectEdf>>): void {
  expect(typeof inspection.ok).toBe('boolean');
  assertAccounted(inspection);
  for (const diagnostic of inspection.diagnostics) {
    expect(typeof diagnostic.code).toBe('string');
    expect(diagnostic.message.length).toBeGreaterThan(0);
    if (diagnostic.byteOffset !== undefined) {
      expect(Number.isSafeInteger(diagnostic.byteOffset)).toBe(true);
      expect(diagnostic.byteOffset).toBeGreaterThanOrEqual(0);
    }
  }
  const header = inspection.header;
  if (header === undefined) return;
  headersReported += 1;
  // A header it chose to report has to be internally coherent, or the report is garbage that
  // happens not to have thrown.
  expect(Number.isSafeInteger(header.recordCount)).toBe(true);
  expect(header.recordCount).toBeGreaterThanOrEqual(0);
  expect(Number.isSafeInteger(header.headerByteLength)).toBe(true);
  expect(Number.isNaN(header.recordDurationSeconds)).toBe(false);
  // NOT `signals.length` against `signals.filter(s => s !== undefined).length`, which is what
  // stood here: a `readonly EdfSignal[]` has no holes, so the filter drops nothing and the line
  // compared a number with itself. The same assertion was written in `whole-api.test.ts` and
  // found there in 0.3.101 — in the test that file's docblock calls the strongest promise in the
  // package — and the copy here outlived it. These are the four consistency claims that one now
  // makes, over damaged bytes rather than over six real files.
  //
  // The two index arrays PARTITION the signals: every signal is data or annotations, none is
  // both, and none is missing from both.
  expect(header.dataSignalIndices.length + header.annotationSignalIndices.length).toBe(
    header.signals.length,
  );
  expect(new Set([...header.dataSignalIndices, ...header.annotationSignalIndices]).size).toBe(
    header.signals.length,
  );
  // The header length it reports is the one its own signal count implies. A report where those
  // two disagree describes a file whose data records begin somewhere it did not say.
  expect(header.headerByteLength).toBe(256 * (header.signals.length + 1));
  for (const [position, signal] of header.signals.entries()) {
    expect(signal.index).toBe(position);
    expect(Number.isSafeInteger(signal.samplesPerRecord)).toBe(true);
    expect(Number.isNaN(signal.scale?.bitValue ?? 0)).toBe(false);
  }
}

/** The claims the report makes about the READ, which hold whether or not a header came back. */
function assertAccounted(inspection: Awaited<ReturnType<typeof inspectEdf>>): void {
  // `ok` is defined as "no error-severity diagnostic", and a reader gates on it.
  expect(inspection.ok).toBe(inspection.diagnostics.every((d) => d.severity !== 'error'));
  // Triage never reads more than the file holds, nor more than its own ceiling.
  expect(inspection.bytesRead).toBeGreaterThanOrEqual(0);
  expect(inspection.bytesRead).toBeLessThanOrEqual(inspection.byteLength);
  expect(inspection.bytesRead).toBeLessThanOrEqual(128 * 1024);
}

describe('uniformly random bytes', () => {
  it('are reported rather than thrown about, at any length', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 2048 }), async (bytes) => {
        const inspection = await inspectEdf(byteSource(bytes));
        assertBelievable(inspection);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('behind a valid version block, which is where a parse gets far enough to be dangerous', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 2048 }), async (tail) => {
        const bytes = new Uint8Array(8 + tail.length);
        bytes.set(VALID.subarray(0, 8), 0);
        bytes.set(tail, 8);
        assertBelievable(await inspectEdf(byteSource(bytes)));
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('a valid file, damaged', () => {
  it('survives a bit flipped anywhere in it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: VALID.byteLength - 1 }),
        fc.integer({ min: 0, max: 7 }),
        async (offset, bit) => {
          const bytes = new Uint8Array(VALID);
          bytes[offset] = (bytes[offset] ?? 0) ^ (1 << bit);
          assertBelievable(await inspectEdf(byteSource(bytes)));
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('survives truncation at every length, exhaustively', async () => {
    // Not sampled: the interesting lengths are the ones that end mid-field, and there are few
    // enough of them to take all of them.
    for (let length = 0; length <= Math.min(VALID.byteLength, 1200); length += 1) {
      assertBelievable(await inspectEdf(byteSource(VALID.subarray(0, length))));
    }
  });
});

describe('what it reports when it succeeds', () => {
  it('says so, and names the variant, on a file that is fine', async () => {
    // The other half of the promise: not throwing is worth nothing if it never says anything.
    const inspection = await inspectEdf(byteSource(VALID));
    expect(inspection.ok).toBe(true);
    expect(inspection.variant).toBe('EDF+C');
    expect(inspection.header?.signals).toHaveLength(3);
  });

  it('says not-ok for a file it could not make sense of', async () => {
    const inspection = await inspectEdf(byteSource(new Uint8Array(64)));
    expect(inspection.ok).toBe(false);
    expect(inspection.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('the consistency claims were reached', () => {
  it('saw a header come back from the damaged bytes, not only from the clean file', () => {
    // Everything from `header !== undefined` onwards is skipped when triage could not parse one,
    // and random bytes almost never produce one. A run where nothing got past that line would
    // report green having checked only that nothing threw.
    expect(headersReported).toBeGreaterThan(100);
  });
});
