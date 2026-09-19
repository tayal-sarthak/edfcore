/**
 * `decodeDigital`'s signal lookup, which said one thing for three different mistakes.
 *
 * 0.6.93 drew the distinction in `getSignal` — 1.5 "is not a whole number, so it falls between two
 * signals rather than outside them" — 0.6.133 carried it to `sample-locate.ts`, and 0.6.218 to the
 * refusal the five reading calls share, whose comment calls a label "not outside anything".
 *
 * `decodeDigital` is a PRIMITIVE, the layer `index.ts` describes as what "a consumer who outgrows
 * the top layer drops to", and it was the last entry point in the package resolving a signal by
 * index with none of that. Every wrong selector got one sentence with the value interpolated raw:
 *
 * - a label: `signalIndex EEG Fpz-Cz is not one of the 3 signals in this header` — said one clause
 *   above advice naming `getSignal(header, label)`, the call that takes labels. It is the label of
 *   signal 0.
 * - a signal from `matchSignals`: `signalIndex [object Object]`, the defect `describeValue` exists
 *   for (0.6.94).
 * - a fraction: the same sentence as 99, for a value that is between two signals rather than past
 *   them.
 *
 * The canonical decimal string stays an index, for the reason 0.6.218 gives: the lookup here IS
 * `header.signals['9']`, which is the property access `header.signals[9]` is. `'  9  '` and `''`
 * are not spellings this header can be indexed by, and reading a number out of them would name a
 * signal nobody wrote.
 *
 * The next step is unchanged, it is still an `EdfChannelNotFoundError`, and `selector` and
 * `availableLabels` still carry what they always did.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { EdfChannelNotFoundError } from '../../../src/errors.js';
import { matchSignals } from '../../../src/header/lookup.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfHeader, RecordRange } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const SIGNALS = 3;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EMG Chin', samplesPerRecord: 4 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const RANGE: RecordRange = { start: 0, count: 2 };

async function decoded(): Promise<{ header: EdfHeader; bytes: Uint8Array }> {
  const recording = await openEdf(byteSource(FILE));
  return {
    header: recording.header,
    bytes: await readRecordBytes(recording.source, recording.header, RANGE),
  };
}

const refusal = async (selector: unknown): Promise<Error> => {
  const { header, bytes } = await decoded();
  let thrown: Error | undefined;
  try {
    decodeDigital(header, bytes, RANGE, selector as never);
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('a label, which is not outside anything', () => {
  it('is no longer called a signal index that is not one of the signals', async () => {
    const thrown = await refusal('EEG Fpz-Cz');
    expect(thrown.message).not.toContain(`is not one of the ${SIGNALS} signals`);
    expect(thrown.message).toContain('not a number this header can be indexed by');
  });

  it('is quoted as the string it is', async () => {
    const thrown = await refusal('EEG Fpz-Cz');
    expect(thrown.message).toContain('the string "EEG Fpz-Cz"');
  });

  it('still names the call that would have accepted it', async () => {
    const thrown = await refusal('EEG Fpz-Cz');
    expect(thrown.message).toContain('getSignal(header, label)');
  });
});

describe('a fraction, which falls between two signals', () => {
  it('says so rather than sharing the out-of-range sentence', async () => {
    const thrown = await refusal(1.5);
    expect(thrown.message).toContain('falls between two signals rather than outside them');
  });
});

describe('a value with no useful text of its own', () => {
  it.each([
    ['an empty object', {}],
    ['an array', []],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
  ])('never prints %s as [object Object]', async (_shape, selector) => {
    const thrown = await refusal(selector);
    expect(thrown.message).not.toContain('[object Object]');
    expect(thrown.message).toContain('not a number this header can be indexed by');
  });

  it('describes a signal from matchSignals rather than interpolating it', async () => {
    const { header } = await decoded();
    const matched = matchSignals(header, /EEG/);
    expect(matched.length).toBeGreaterThan(0);
    const thrown = await refusal(matched[0]);
    expect(thrown.message).not.toContain('[object Object]');
    expect(thrown.message).toContain('signalIndex is an object');
  });
});

describe('the spellings of a number', () => {
  it('keeps the canonical decimal string as the index it spells', async () => {
    const thrown = await refusal('9');
    expect(thrown.message).toContain(`signalIndex 9 is not one of the ${SIGNALS} signals`);
  });

  it.each([
    ['padded', '  9  '],
    ['empty', ''],
    ['hexadecimal', '0x10'],
  ])('leaves a %s string described as a string', async (_shape, selector) => {
    const thrown = await refusal(selector);
    expect(thrown.message).toContain(`the string ${JSON.stringify(selector)}`);
    expect(thrown.message).toContain('not a number this header can be indexed by');
  });
});

describe('an index that really is one', () => {
  it.each([
    ['past the end', 99],
    ['negative', -1],
  ])('keeps the out-of-range sentence for a %s index', async (_shape, selector) => {
    const thrown = await refusal(selector);
    expect(thrown.message).toContain(
      `signalIndex ${selector} is not one of the ${SIGNALS} signals in this header`,
    );
  });

  it('still decodes a signal the file has', async () => {
    const { header, bytes } = await decoded();
    expect(decodeDigital(header, bytes, RANGE, 0).length).toBe(16);
  });
});

describe('the error itself', () => {
  it.each([
    ['a label', 'EEG Fpz-Cz'],
    ['a fraction', 1.5],
    ['an index past the end', 99],
  ])('stays an EdfChannelNotFoundError carrying its labels, for %s', async (_shape, selector) => {
    const thrown = (await refusal(selector)) as EdfChannelNotFoundError;
    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
    expect(thrown.availableLabels).toContain('EEG Fpz-Cz');
    expect(thrown.message.endsWith('getSignal(header, label).')).toBe(true);
  });
});
