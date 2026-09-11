/**
 * `decodeStatusWord` and the values `&` used to accept.
 *
 * The function's whole body was `sample & 0xffffff` and four bit tests. In JavaScript `&` coerces
 * rather than refuses: `undefined`, `null`, `NaN` and a string all become `0`, and `0` is a
 * perfectly well-formed Status word — no trigger asserted, a new epoch that did not start, CMS in
 * range, battery fine. A caller indexing the wrong array got that back and had nothing to tell it
 * apart from a real sample (fixed in 0.6.80).
 *
 * That is the clause `fuzz.test.ts` calls the one the library exists for: "a wrong number that
 * looks like a number is worse than a refusal." The value is not even wrong in a way anyone can
 * see — a Status word of zero is the most ordinary sample in a BDF file.
 *
 * Two more went the same way. `1.5` truncated to trigger code 1, and anything wider than 24 bits
 * was masked down rather than questioned — so a value that could not be a BDF sample at all came
 * back as one.
 *
 * The bound admits both spellings of a 24-bit word, because both arrive legitimately.
 * `decodeDigital` sign-extends, so a real sample with bit 23 set is negative; a caller writing a
 * bit pattern by hand spells the same word unsigned, up to `0xffffff` — which is what
 * `biosemi.test.ts` does for an idle MK2 word, and what a first draft of this guard refused.
 */

import { describe, expect, it } from 'vitest';
import { decodeStatusWord, readTriggers } from '../../src/biosemi.js';
import { BDF_DIGITAL_MAX, BDF_DIGITAL_MIN } from '../../src/constants.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const decode = decodeStatusWord as (sample: unknown) => unknown;

/** Values `&` turned into a clean word, and what it called them. */
const COERCED: ReadonlyArray<readonly [string, unknown, string]> = [
  ['undefined', undefined, 'undefined'],
  ['null', null, 'null'],
  ['NaN', Number.NaN, 'NaN'],
  ['a string', 'x', 'a string'],
  ['a fraction', 1.5, '1.5'],
  ['a value wider than 24 bits', 2 ** 30, '1073741824'],
  ['one past the unsigned end', 0x1000000, '16777216'],
];

describe.each(COERCED)('%s', (_name, value, shown) => {
  it('is refused rather than decoded', () => {
    expect(() => decode(value)).toThrow(RangeError);
  });

  it('is named as itself, and the message says what to pass', () => {
    let message = '';
    try {
      decode(value);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`decodeStatusWord(): ${shown} is not a 24-bit Status word`);
    expect(message).toContain('Next: pass one element of the');
  });

  it('is a caller mistake, not a file one', () => {
    try {
      decode(value);
    } catch (error) {
      expect(isEdfError(error)).toBe(false);
    }
  });
});

describe('the two spellings of a 24-bit word', () => {
  it('accepts the sign-extended one decodeDigital returns', () => {
    for (const sample of [BDF_DIGITAL_MIN, -1, 0, 1, BDF_DIGITAL_MAX]) {
      expect(() => decodeStatusWord(sample)).not.toThrow();
    }
    // -1 is every bit set, which is what the mask exists to put back.
    expect(decodeStatusWord(-1).raw).toBe(0xffffff);
    expect(decodeStatusWord(-1).batteryLow).toBe(true);
  });

  it('accepts the unsigned one a caller writes by hand, including bit 23', () => {
    // The idle MK2 word `biosemi.test.ts` uses: MK2, CMS in range, speed mode 4.
    const idle = decodeStatusWord((1 << 23) | (1 << 20) | (1 << 19));
    expect(idle.cmsInRange).toBe(true);
    expect(idle.trigger).toBe(0);
    expect(() => decodeStatusWord(0xffffff)).not.toThrow();
  });

  it('refuses one past either end', () => {
    expect(() => decodeStatusWord(BDF_DIGITAL_MIN - 1)).toThrow(RangeError);
    expect(() => decodeStatusWord(0x1000000)).toThrow(RangeError);
  });
});

describe('readTriggers, which decodes every Status sample itself', () => {
  it('still works on a file whose Status words set the top bit', async () => {
    const file = buildEdf({
      format: 'BDF',
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [
        { label: 'A1', samplesPerRecord: 4 },
        {
          label: 'Status',
          samplesPerRecord: 4,
          raw: { physicalMinimum: '-8388608', physicalMaximum: '8388607' },
          sample: (_second: number, index: number) => (index === 0 ? -1 : 0),
        },
      ],
      annotationSignals: [{ samplesPerRecord: 40 }],
    });
    const recording = await openEdf(byteSource(file));
    const events = await readTriggers(recording, { startSeconds: 0, durationSeconds: 4 });
    expect(events.length).toBeGreaterThan(0);
  });
});
