/**
 * `maxMaterializeBytes` is a ceiling that includes itself.
 *
 * Three modules resolve the budget and compare against it — `io/read.ts` before a record range,
 * `decode/digital.ts` before the `Int32Array`, and `envelope.ts` before the bucket accumulators —
 * and all three admit a requirement EQUAL to the budget. Every existing test sets a budget far
 * below what it asks for or far above it, so relaxing any of the three comparisons to a strict one
 * left the whole suite green, and each of them separately.
 *
 * Equality is not a curiosity here. `readRecordBytes` is the call whose size a caller controls
 * directly, and the documented way to stay inside a budget is to size the request to it — take
 * `maxMaterializeBytes`, divide by `header.recordByteLength`, read that many records. Done exactly,
 * that lands ON the number every time, so a strict comparison refuses the arithmetic the error
 * message itself recommends: "read fewer records per call" would be advice a caller had already
 * followed perfectly.
 *
 * Both sides of each boundary are asserted, and the refusal is checked to name the same two
 * numbers on `requiredBytes` and `budgetBytes` — the fields `api-errors.md` documents for exactly
 * this, so a caller can compute the next request rather than guess at it.
 *
 * There are FIVE such comparisons, not three. This file covered three when it was written, found
 * by grepping for `resolveMaterializeBudget`; 0.4.482 found a fourth in `validate.ts` whose local
 * variable the grep walked past, and 0.4.491 a fifth in `decode/physical.ts`. Finding them one at
 * a time is the thing that keeps going wrong, so the last test below enumerates the refusal sites
 * out of `src/` and fails on a sixth until it is listed here — which is the only way this stops
 * being a rule that half the code follows.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDigitalCounted } from '../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../src/decode/physical.js';
import { readEnvelope } from '../../src/envelope.js';
import { EdfBudgetError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

/** One signal, ten 2-byte samples per record, two records: 20 bytes a record and 40 in all. */
const BYTES = minimalEdf();
const RECORDS = { start: 0, count: 2 } as const;
const RANGE_BYTES = 40;
/** Twenty samples in an `Int32Array`. */
const DECODE_BYTES = 80;
/** Ten buckets over one signal, at twelve bytes a bucket. */
const BUCKETS = 10;
const ENVELOPE_BYTES = 120;

async function opened() {
  return openEdf(byteSource(BYTES));
}

function budgetErrorFrom(thrown: unknown): EdfBudgetError {
  expect(thrown).toBeInstanceOf(EdfBudgetError);
  return thrown as EdfBudgetError;
}

async function refusal(call: () => Promise<unknown>): Promise<EdfBudgetError> {
  const caught = await call().then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
  if (caught === undefined) throw new Error('the call resolved and was supposed to be refused');
  return budgetErrorFrom(caught.error);
}

describe('a record range whose size is exactly the budget', () => {
  it('is read', async () => {
    const recording = await opened();
    const bytes = await readRecordBytes(recording.source, recording.header, RECORDS, {
      maxMaterializeBytes: RANGE_BYTES,
    });
    expect(bytes).toHaveLength(RANGE_BYTES);
  });

  it('and one byte less of budget refuses it, naming both numbers', async () => {
    const recording = await opened();
    const error = await refusal(() =>
      readRecordBytes(recording.source, recording.header, RECORDS, {
        maxMaterializeBytes: RANGE_BYTES - 1,
      }),
    );
    expect(error.requiredBytes).toBe(RANGE_BYTES);
    expect(error.budgetBytes).toBe(RANGE_BYTES - 1);
    expect(error.optionName).toBe('maxMaterializeBytes');
  });
});

describe('a decode whose array is exactly the budget', () => {
  it('is decoded', async () => {
    const recording = await opened();
    const bytes = await readRecordBytes(recording.source, recording.header, RECORDS);
    const decoded = decodeDigitalCounted(recording.header, bytes, RECORDS, 0, undefined, {
      maxMaterializeBytes: DECODE_BYTES,
    });
    expect(decoded.digital).toHaveLength(20);
  });

  it('and one byte less of budget refuses it', async () => {
    const recording = await opened();
    const bytes = await readRecordBytes(recording.source, recording.header, RECORDS);
    const error = budgetErrorFrom(
      (() => {
        try {
          decodeDigitalCounted(recording.header, bytes, RECORDS, 0, undefined, {
            maxMaterializeBytes: DECODE_BYTES - 1,
          });
          return undefined;
        } catch (thrown) {
          return thrown;
        }
      })(),
    );
    expect(error.requiredBytes).toBe(DECODE_BYTES);
    expect(error.budgetBytes).toBe(DECODE_BYTES - 1);
  });
});

describe('an envelope whose accumulators are exactly the budget', () => {
  const selection = { signalIndices: [0], startSeconds: 0, durationSeconds: 2, buckets: BUCKETS };

  it('is built', async () => {
    const recording = await opened();
    const [envelope] = await readEnvelope(recording, selection, {
      maxMaterializeBytes: ENVELOPE_BYTES,
    });
    expect(envelope?.signals[0]?.min).toHaveLength(BUCKETS);
  });

  it('and one byte less of budget refuses it', async () => {
    const recording = await opened();
    const error = await refusal(() =>
      readEnvelope(recording, selection, { maxMaterializeBytes: ENVELOPE_BYTES - 1 }),
    );
    expect(error.requiredBytes).toBe(ENVELOPE_BYTES);
    expect(error.budgetBytes).toBe(ENVELOPE_BYTES - 1);
  });
});

describe('a physical conversion whose array is exactly the budget', () => {
  /** Ten samples: eighty bytes as float64, forty as the clamped int32. */
  const DIGITAL = Int32Array.from({ length: 10 }, (_, at) => at);

  async function scaledSignal() {
    const recording = await opened();
    const signal = recording.header.signals[0];
    if (signal === undefined) throw new Error('fixture has no signal');
    return signal;
  }

  it('is converted', async () => {
    const signal = await scaledSignal();
    const physical = toPhysical(signal, DIGITAL, undefined, { maxMaterializeBytes: 80 });
    expect(physical).toHaveLength(10);
  });

  it('and one byte less of budget refuses it', async () => {
    const signal = await scaledSignal();
    const error = budgetErrorFrom(
      (() => {
        try {
          toPhysical(signal, DIGITAL, undefined, { maxMaterializeBytes: 79 });
          return undefined;
        } catch (thrown) {
          return thrown;
        }
      })(),
    );
    expect(error.requiredBytes).toBe(80);
    expect(error.budgetBytes).toBe(79);
  });

  it('applies the same rule to the clamped int32 array, at its own size', async () => {
    // Four bytes a sample rather than eight, so the boundary is a different number reached by the
    // same comparison — which is what makes it worth stating separately.
    const signal = await scaledSignal();
    expect(
      clampToDigitalRange(signal, DIGITAL, undefined, { maxMaterializeBytes: 40 }),
    ).toHaveLength(10);
    const error = budgetErrorFrom(
      (() => {
        try {
          clampToDigitalRange(signal, DIGITAL, undefined, { maxMaterializeBytes: 39 });
          return undefined;
        } catch (thrown) {
          return thrown;
        }
      })(),
    );
    expect(error.requiredBytes).toBe(40);
  });
});

describe('the refusal sites', () => {
  /** The modules that compare a requirement against the budget, each covered above. */
  const COVERED = [
    'decode/digital.ts',
    'decode/physical.ts',
    'envelope.ts',
    'io/read.ts',
    'validate.ts',
  ] as const;

  function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
        continue;
      }
      if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
    }
    return into;
  }

  it('are the five this file covers, and no others', () => {
    const src = new URL('../../src/', import.meta.url);
    const found = sourceFiles(src, '', [])
      .filter((name) =>
        /if \([^)]*\b(?:requiredBytes|bucketBytes|scratchBytes)\b[^)]*budgetBytes/.test(
          readFileSync(new URL(name, src), 'utf8'),
        ),
      )
      .sort();

    expect(found).toEqual([...COVERED]);
  });

  it('read the tree, so a passing run is not a vacuous one', () => {
    const src = new URL('../../src/', import.meta.url);
    expect(sourceFiles(src, '', []).length).toBeGreaterThan(30);
  });
});

describe('the five agree, which is the point of checking all five', () => {
  it('lets a caller size a request from the budget and have it accepted', async () => {
    // The recipe the error message recommends, followed exactly: divide the budget by the record
    // size and read that many records. It lands on the number, so a strict comparison anywhere
    // would refuse a request computed from its own advice.
    const recording = await opened();
    const budget = RANGE_BYTES;
    const count = Math.floor(budget / recording.header.recordByteLength);
    expect(count).toBe(2);
    const bytes = await readRecordBytes(
      recording.source,
      recording.header,
      { start: 0, count },
      { maxMaterializeBytes: budget },
    );
    expect(bytes).toHaveLength(budget);
  });
});
