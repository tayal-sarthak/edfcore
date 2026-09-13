/**
 * `formatHeader`'s options, passed as a bare value.
 *
 * The same shape 0.6.130, 0.6.140, 0.6.154, 0.6.163 and 0.6.164 refused elsewhere: every option in
 * this package is a field on an object, so the value a caller means IS the option, and these
 * options are two flags and nothing else — `formatHeader(header, true)` is what gets written for
 * "include the identification".
 *
 * What makes it worth naming here is that the failure is INVISIBLE IN THE OUTPUT.
 *
 * When the lines are asked for, an empty identification field prints as `unknown`. That is this
 * module's stated promise — it never invents a value, "because the whole point of pasting this
 * somewhere is that the reader can trust it" — and 0.3.48 is a whole release about making that
 * `unknown` reachable. When the flag is dropped the lines are not printed AT ALL, so the summary is
 * byte-identical to one that never asked, and a reader checking whether a file carries a name
 * concludes that it does not.
 *
 * `diagnosticsHint` goes the same way, which is how `edfcore header` turns the hint off.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  patientId: 'MCH-0234567 F 02-MAY-1951 Haagse_Harry',
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const header = (): EdfHeader => parseHeader(FILE, FILE.byteLength);

const format = (options: unknown): string =>
  (formatHeader as unknown as (h: EdfHeader, o: unknown) => string)(header(), options);

describe.each([
  ['true, the flag itself', true],
  ['false', false],
  ['a string naming the field', 'includePatientId'],
])('options that are %s', (_name, options) => {
  it('are refused rather than taken as no options at all', () => {
    expect(() => format(options)).toThrow(RangeError);
  });

  it('say which field was about to be dropped, and what the output would have looked like', () => {
    try {
      format(options);
      expect.unreachable('a bare value must not silently withhold the identification');
    } catch (error) {
      expect((error as Error).message).toContain('formatHeader()');
      expect((error as Error).message).toContain('includePatientId is a field on one');
      expect((error as Error).message).toContain('Next:');
    }
  });
});

describe('why the omission could not be seen', () => {
  it('prints the identification when it is asked for on an object', () => {
    expect(formatHeader(header(), { includePatientId: true })).toContain('Haagse_Harry');
  });

  it('is byte-identical to a summary nobody asked for when the flag is dropped', () => {
    // The state a bare `true` used to produce, reachable only on purpose now.
    expect(formatHeader(header(), { includePatientId: false })).toBe(formatHeader(header()));
  });
});

describe('the options it does take', () => {
  it('still formats with no options at all', () => {
    expect(format(undefined)).toContain('1 signal');
  });

  it('still takes null as "no options"', () => {
    expect(format(null)).toContain('1 signal');
  });

  it('still honours diagnosticsHint on an object', () => {
    const quiet = formatHeader(header(), { diagnosticsHint: false });
    expect(quiet).not.toContain('Call formatDiagnostics');
  });
});
