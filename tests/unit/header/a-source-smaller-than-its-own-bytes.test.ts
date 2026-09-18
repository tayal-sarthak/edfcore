/**
 * `parseHeader` given a `sourceByteLength` below the length of the bytes handed in.
 *
 * The two arguments describe one file from two directions: `sourceByteLength` is the length of the
 * WHOLE file, and `headerBytes` is a prefix read out of it. A source smaller than the bytes taken
 * from it is not a file any reader can produce, in any adapter, ever.
 *
 * It was accepted, and the size checks then reported `TRUNCATED_FILE` — a diagnostic asserting the
 * FILE is short — for a number the caller computed. That is the confusion this function is careful
 * about everywhere else: the guard directly above says an `EdfFormatError` there "would claim the
 * bytes are wrong when what is wrong is the number describing them", and refuses with a plain
 * `RangeError` for exactly that reason.
 *
 * So does this one, and for the second reason `inspect-rethrows-caller-bugs.test.ts` pins: an
 * `EdfError` is turned into a diagnostic about the file by `inspectEdf`, and a mistake in the
 * arguments must stay outside the family.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

describe('a source shorter than the bytes read from it', () => {
  it.each([
    ['zero', 0],
    ['a couple of bytes', 2],
    ['one byte short', FILE.byteLength - 1],
  ])('is refused rather than reported as a truncated file: %s', (_name, sourceByteLength) => {
    let thrown: Error | undefined;
    try {
      parseHeader(FILE, sourceByteLength);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the pair was accepted and blamed on the file').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('bytes were handed in');
    expect(thrown?.message).toContain('Next:');
  });

  it('stays outside the EdfError family, so triage cannot absorb it', () => {
    const thrown = ((): unknown => {
      try {
        parseHeader(FILE, 2);
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(isEdfError(thrown)).toBe(false);
  });

  it('says which length to pass, since the header’s own length is the tempting one', () => {
    expect(() => parseHeader(FILE, 2)).toThrow(/the length of the whole file, not of the header/);
    expect(() => parseHeader(FILE, 2)).toThrow(/source\.byteLength/);
  });

  it('no longer reports TRUNCATED_FILE about a file that is not truncated', () => {
    // The old answer: a header that parsed, with a diagnostic saying the recording was cut short.
    const honest = parseHeader(FILE, FILE.byteLength);
    expect(honest.diagnostics.map((one) => one.code)).not.toContain('TRUNCATED_FILE');
    expect(() => parseHeader(FILE, 2)).toThrow(RangeError);
  });
});

describe('the pairs that describe a real file', () => {
  it('still parse when the two agree', () => {
    expect(parseHeader(FILE, FILE.byteLength).recordCount).toBe(4);
  });

  it('still parse a header prefix with the whole file’s length beside it', () => {
    const whole = parseHeader(FILE, FILE.byteLength);
    const headerOnly = FILE.subarray(0, whole.headerByteLength);
    expect(parseHeader(headerOnly, FILE.byteLength).recordCount).toBe(4);
  });

  it('still report a genuinely truncated file, where the source really is short', () => {
    const whole = parseHeader(FILE, FILE.byteLength);
    const headerOnly = FILE.subarray(0, whole.headerByteLength);
    const parsed = parseHeader(headerOnly, headerOnly.byteLength);
    expect(parsed.diagnostics.map((one) => one.code)).toContain('TRUNCATED_FILE');
  });

  it('still refuse a sourceByteLength that is not a byte count at all', () => {
    expect(() => parseHeader(FILE, -1)).toThrow(/must be a non-negative safe integer/);
    expect(() => parseHeader(FILE, Number.NaN)).toThrow(/must be a non-negative safe integer/);
  });
});
