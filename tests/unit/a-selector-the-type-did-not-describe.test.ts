/**
 * `EdfChannelNotFoundError.selector`, when what was refused was neither a label nor an index.
 *
 * The narrowing on this error keeps "only what the declared type can hold" and leaves everything
 * else empty — and `undefined` was not in that type. The field was cast to `string | number` while
 * holding neither, so the one part of an error a program acts on rather than reads was the one part
 * the compiler had been told to stop checking.
 *
 * Every selector that is not a label, an index, or a signal carrying one lands there: a BigInt
 * index, a plain object, `null`. A handler then branches `typeof selector === 'number' ? byIndex :
 * byLabel` and looked up `undefined` as a label, or printed "undefined" beside `availableLabels` in
 * a log line.
 *
 * 0.6.277 and 0.6.278 closed the same shape on `EdfRangeError`'s range and `EdfSourceError`'s
 * offset. Those two substituted `NaN`, because both fields are counts and `NaN` is a number that
 * cannot be mistaken for one. This field is not a count: `NaN` would say "an index that is not a
 * number", and these selectors were not indices at all. So the type is widened instead, which
 * `concepts.md` gives the precedent for — `sampleRateHz` is `number | undefined` so that
 * "`strictNullChecks` makes you handle it".
 *
 * Nothing else moves. A label stays a string, an index stays a number, a signal still contributes
 * its own `index` — which is the selector the message tells the caller to pass — and
 * `availableLabels` is untouched.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { getSignal } from '../../src/header/lookup.js';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fp1', samplesPerRecord: 4 },
    { label: 'EEG C3', samplesPerRecord: 4 },
  ],
});

const header = (): EdfHeader => parseHeader(FILE, FILE.byteLength);

const refusal = (call: () => unknown): EdfChannelNotFoundError => {
  let thrown: unknown;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'nothing was refused').toBeInstanceOf(EdfChannelNotFoundError);
  return thrown as EdfChannelNotFoundError;
};

const decode = decodeDigital as unknown as (
  header: unknown,
  bytes: unknown,
  records: unknown,
  signalIndex: unknown,
) => unknown;

const recordBytes = (): Uint8Array => new Uint8Array(header().recordByteLength * 2);
const RECORDS = { start: 0, count: 2 };

describe('a selector the declared type never described', () => {
  it.each([
    ['a BigInt index', 99n],
    ['a plain object', { index: 'nope' }],
    ['null', null],
    ['a boolean', true],
  ])('is reported as undefined rather than cast to a label or an index, for %s', (_name, given) => {
    const error = refusal(() => decode(header(), recordBytes(), RECORDS, given));
    expect(error.selector).toBeUndefined();
  });

  it('is a case a handler can now be made to deal with', () => {
    const error = refusal(() => decode(header(), recordBytes(), RECORDS, 99n));
    // The branch a consumer writes. Before the widening, TypeScript let this read the label arm
    // with `undefined` in it.
    const described =
      error.selector === undefined
        ? 'neither a label nor an index'
        : typeof error.selector === 'number'
          ? `index ${error.selector}`
          : `label ${error.selector}`;
    expect(described).toBe('neither a label nor an index');
  });

  it('still carries the labels a reader needs either way', () => {
    const error = refusal(() => decode(header(), recordBytes(), RECORDS, 99n));
    expect(error.availableLabels).toEqual(['EEG Fp1', 'EEG C3']);
  });
});

describe('the selectors the type does describe', () => {
  it('keep their own values', () => {
    expect(refusal(() => getSignal(header(), 'nope')).selector).toBe('nope');
    expect(refusal(() => decode(header(), recordBytes(), RECORDS, 99)).selector).toBe(99);
    expect(refusal(() => decode(header(), recordBytes(), RECORDS, 0.5)).selector).toBe(0.5);
  });

  it('include a signal, which contributes the index the message tells you to pass', () => {
    const signal = header().signals[1];
    if (signal === undefined) throw new Error('fixture');
    const error = refusal(() => decode(header(), recordBytes(), RECORDS, { ...signal, index: 99 }));
    expect(error.selector).toBe(99);
  });

  it('and nothing else from a signal reaches the payload', () => {
    const signal = header().signals[0];
    if (signal === undefined) throw new Error('fixture');
    const error = refusal(() => decode(header(), recordBytes(), RECORDS, { ...signal, index: 99 }));
    expect(JSON.stringify(error.selector)).toBe('99');
  });
});
