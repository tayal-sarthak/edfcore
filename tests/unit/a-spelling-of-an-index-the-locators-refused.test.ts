/**
 * `sampleAt`, `sampleStartTicksOf` and `sampleStartSecondsOf`, given the canonical decimal string.
 *
 * These three share one lookup, and it is `recording.header.signals[signalIndex]` — so
 * `signals['9']` is the property access `signals[9]` is, the coercion `a-selection-from-json.test`
 * names and 0.6.135 deduplicates against. The selection built from JSON, from a query parameter or
 * from a form arrives with its index as text, and it indexes the header exactly as the number does.
 *
 * The refusal said the opposite: `signalIndex is the string "9", not a number this header can be
 * indexed by`. It is the one thing it IS. Index 9 is simply not in a 3-signal file — which is the
 * sentence the same guard prints for `9` — and the message blamed the spelling instead, sending a
 * reader to convert a value that needed no converting.
 *
 * 0.6.218 made this argument for the refusal the five reading calls share and 0.6.225 for
 * `decodeDigital`. This module's copy is older than both: 0.6.133 wrote it, and calls itself "the
 * other copy of that message".
 *
 * Only a round-trip-exact spelling counts. `'  9  '` and `''` are not spellings this header can be
 * indexed by — `signals['  9  ']` is not `signals[9]` — and reading 9 or 0 out of them would name a
 * signal nobody wrote. A label is untouched, and so is every number.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

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

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const CALLS: ReadonlyArray<readonly [string, (r: EdfRecording, s: unknown) => unknown]> = [
  ['sampleAt', (r, s) => sampleAt(r, s as never, 1)],
  ['sampleStartTicksOf', (r, s) => sampleStartTicksOf(r, s as never, 1)],
  ['sampleStartSecondsOf', (r, s) => sampleStartSecondsOf(r, s as never, 1)],
];

const refusal = async (
  call: (r: EdfRecording, s: unknown) => unknown,
  selector: unknown,
): Promise<Error> => {
  const recording = await opened();
  let thrown: Error | undefined;
  try {
    call(recording, selector);
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe.each(CALLS)('%s', (_name, call) => {
  it('diagnoses the canonical decimal string as the index it spells', async () => {
    const thrown = await refusal(call, '9');
    expect(thrown.message).toContain(`signalIndex 9 is outside the ${SIGNALS} signals`);
    expect(thrown.message).not.toContain('not a number this header can be indexed by');
  });

  it('says the same thing for that string as for the number', async () => {
    const asText = await refusal(call, '9');
    const asNumber = await refusal(call, 9);
    expect(asText.message).toBe(asNumber.message);
  });

  it('diagnoses a fractional spelling as falling between two signals', async () => {
    const thrown = await refusal(call, '1.5');
    expect(thrown.message).toContain('falls between two signals rather than outside them');
  });

  it.each([
    ['padded', '  9  '],
    ['empty', ''],
    ['hexadecimal', '0x10'],
    ['a label', 'EEG Fpz-Cz'],
  ])('leaves a %s string described as the string it is', async (_shape, selector) => {
    const thrown = await refusal(call, selector);
    expect(thrown.message).toContain(`the string ${JSON.stringify(selector)}`);
    expect(thrown.message).toContain('not a number this header can be indexed by');
  });

  it.each([
    ['past the end', 99],
    ['negative', -1],
  ])('keeps the sentence for a %s index', async (_shape, selector) => {
    const thrown = await refusal(call, selector);
    expect(thrown.message).toContain(`signalIndex ${selector} is outside the ${SIGNALS} signals`);
  });

  it('keeps the fraction sentence for a fractional number', async () => {
    const thrown = await refusal(call, 1.5);
    expect(thrown.message).toContain('falls between two signals rather than outside them');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['NaN', Number.NaN],
  ])('never prints %s as [object Object]', async (_shape, selector) => {
    const thrown = await refusal(call, selector);
    expect(thrown.message).not.toContain('[object Object]');
    expect(thrown.message).toContain('not a number this header can be indexed by');
  });

  it('stays an EdfChannelNotFoundError carrying what it always did', async () => {
    const thrown = (await refusal(call, '9')) as EdfChannelNotFoundError;
    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
    expect(thrown.selector).toBe('9');
    expect(thrown.availableLabels).toContain('EEG Fpz-Cz');
    expect(thrown.message).toContain('header.dataSignalIndices');
  });

  it('still answers for a signal the file has, in either spelling', async () => {
    const recording = await opened();
    expect(call(recording, 0)).toBeDefined();
    expect(call(recording, '0')).toBeDefined();
  });
});
