/**
 * `decodeStatusWord(digital)` — the whole channel where one sample of it belongs.
 *
 * Two shapes reach this guard, and its own note named them both: "`decodeStatusWord(chunk.signals[0])`
 * — the signal rather than one sample of its `digital` — is an object, and so is the typed array one
 * field along". It then said "an object" for each. The typed array is the nearer miss of the two — one
 * field and one index from correct, and the `Int32Array` this call's own `Next:` clause tells the
 * reader to take an element of — so it is the one where naming the kind rather than the value costs
 * the most.
 *
 * `describe.ts` already owns the answer, and gives the reason: a binary value is named by its
 * built-in tag "because that IS the mistake wherever one turns up", and "an object" there "says
 * nothing a reader can act on". It also states the rule this module was breaking by carrying its own
 * list: "two copies of a rule have to be kept in agreement, and one does not".
 *
 * Delegating brings three more values with it. A pending Promise is named as one, which matters here
 * because `readTriggers` is the async sibling in this same module. A string and a BigInt are named
 * with their values, which is what `describe.ts` exists for — "a BigInt is the case that costs the
 * most", since every instant this package hands out is ticks.
 *
 * What does not move: numbers keep their bare spelling, so `NaN`, `1.5` and a genuinely out-of-range
 * integer read exactly as they did; `null` and `undefined` keep theirs; and a plain object, an array
 * and a `Map` are still "an object", which is the article 0.6.244 was spent on.
 */

import { describe, expect, it } from 'vitest';
import { decodeStatusWord, readTriggers } from '../../src/biosemi.js';
import { decodeDigital } from '../../src/decode/digital.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'BDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 4 },
    { label: 'Status', samplesPerRecord: 4, physicalDimension: 'Boolean' },
  ],
});

const decode = decodeStatusWord as (sample: unknown) => unknown;

const refusal = (given: unknown): string => {
  try {
    decode(given);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

describe('the Status channel passed whole', () => {
  it('is named by its type rather than called an object', async () => {
    const recording = await openEdf(byteSource(FILE));
    const records = { start: 0, count: 2 };
    const bytes = await readRecordBytes(recording.source, recording.header, records);
    const digital = decodeDigital(recording.header, bytes, records, 1);
    const message = refusal(digital);
    expect(message).toContain('Int32Array is not a 24-bit Status word');
    expect(message).not.toContain('an object');
  });

  it('still advises taking one element of exactly that array', async () => {
    const recording = await openEdf(byteSource(FILE));
    const records = { start: 0, count: 2 };
    const bytes = await readRecordBytes(recording.source, recording.header, records);
    const digital = decodeDigital(recording.header, bytes, records, 1);
    expect(refusal(digital)).toContain('pass one element of the Int32Array');
    // And the advice works: the element it names decodes.
    expect(() => decodeStatusWord(digital[0] as number)).not.toThrow();
  });

  it('says so for every width of view, since none of them is a sample', () => {
    expect(refusal(new Uint8Array(4))).toContain('Uint8Array is not a 24-bit');
    expect(refusal(new Float64Array(4))).toContain('Float64Array is not a 24-bit');
    expect(refusal(new ArrayBuffer(4))).toContain('ArrayBuffer is not a 24-bit');
  });
});

describe('the async sibling in this same module', () => {
  it('is named as a pending Promise when its await is forgotten', async () => {
    const recording = await openEdf(byteSource(FILE));
    const pending = readTriggers(recording, { startSeconds: 0, durationSeconds: 2 });
    expect(refusal(pending)).toContain('a pending Promise');
    await pending;
  });
});

describe('the values named with themselves now', () => {
  it('include a string and a BigInt, which said only their kind', () => {
    expect(refusal('5')).toContain('the string "5" is not a 24-bit');
    expect(refusal(5n)).toContain('the BigInt 5n is not a 24-bit');
  });
});

describe('the values that do not move', () => {
  it('are the numbers, which always read as themselves', () => {
    expect(refusal(Number.NaN)).toContain('NaN is not a 24-bit');
    expect(refusal(1.5)).toContain('1.5 is not a 24-bit');
    expect(refusal(0x1000000)).toContain('16777216 is not a 24-bit');
  });

  it('are null and undefined, answered above the article', () => {
    expect(refusal(null)).toContain('null is not a 24-bit');
    expect(refusal(undefined)).toContain('undefined is not a 24-bit');
  });

  it('are the plain objects 0.6.244 was spent on', () => {
    for (const given of [{}, [], new Map()]) {
      expect(refusal(given)).toContain('an object is not a 24-bit');
      expect(refusal(given)).not.toContain('a object');
    }
  });

  it('and a real Status word still decodes', () => {
    expect(decodeStatusWord(0).trigger).toBe(0);
    expect(decodeStatusWord(-1).trigger).toBe(0xffff);
  });
});
