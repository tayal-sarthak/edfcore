/**
 * What `index.onsetTicks()` says about a record index it will not accept.
 *
 * The refusal was one flat sentence — "record N is not one of the R data records this file
 * contains" — and for two of the three reasons a value reaches it, that sentence was false.
 *
 * A string is the plain case. `${recordIndex}` interpolates `'2'` as `2`, so `onsetTicks('2')` on
 * an eight-record file came back with "record 2 is not one of the 8 data records this file
 * contains. Next: pass an index in 0..7" — naming a rule the printed value satisfies, about a
 * record that is right there. A reader has no way to tell from the message that anything was
 * wrong with what they passed.
 *
 * A fractional index is the same shape one step subtler: 1.5 is not outside the eight records, it
 * falls between two of them. 0.6.93 drew exactly that distinction for `getSignal`'s own index —
 * "is not a whole number, so it falls between two signals rather than outside them" — and this is
 * the other index in the package that takes one.
 *
 * The genuinely-out-of-range case is unchanged, because for that one the sentence was true.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecordIndex } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const index = async (): Promise<EdfRecordIndex> => (await openEdf(byteSource(FILE))).index;

async function thrownBy(recordIndex: unknown): Promise<Error> {
  const onsets = await index();
  try {
    await (onsets.onsetTicks as unknown as (r: unknown) => Promise<bigint>)(recordIndex);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was accepted');
}

describe('a record index that arrived as text', () => {
  it('is not described as a record this file does not contain', async () => {
    const { message } = await thrownBy('2');
    expect(message).not.toContain('record 2 is not one of');
    expect(message).not.toContain('is not one of the 8 data records');
  });

  it('is named as the string it is', async () => {
    expect((await thrownBy('2')).message).toContain('record the string "2" is not a number');
  });

  it('still says what to pass', async () => {
    expect((await thrownBy('2')).message).toContain('Next: pass a whole index in 0..7');
  });

  it('is still an EdfRangeError, which is what a range refusal has always been', async () => {
    expect(isEdfError(await thrownBy('2'))).toBe(true);
  });
});

describe('a record index between two records', () => {
  it('is described as falling between them rather than outside them', async () => {
    const { message } = await thrownBy(1.5);
    expect(message).toContain(
      'record 1.5 is not a whole number, so it falls between two records rather than outside them',
    );
    expect(message).not.toContain('is not one of the 8 data records');
  });
});

describe('a record index that is no number at all', () => {
  it.each([
    [undefined, 'record undefined is not a number'],
    [Number.NaN, 'record NaN is not finite'],
    [Number.POSITIVE_INFINITY, 'record Infinity is not finite'],
  ])('%s says so', async (value, expected) => {
    expect((await thrownBy(value)).message).toContain(expected);
  });
});

describe('a record index that really is outside the file', () => {
  it('is described exactly as before, because for it the sentence was true', async () => {
    for (const value of [-1, 8, 99]) {
      const { message } = await thrownBy(value);
      expect(message).toContain(
        `record ${value} is not one of the 8 data records this file contains`,
      );
    }
  });
});
