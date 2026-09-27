/**
 * The option `formatHeader` was telling readers to pass.
 *
 * 0.6.247 gave the four formatters an array branch on one argument, and `assertOptions` states the
 * reason it is worth having: `redactFields` "takes `['patientId', 'recordingId']`, so a caller
 * holding that list writes it where the options go". True of the three listing formatters. Not true
 * of this one — `FormatHeaderOptions` is `includePatientId` and `diagnosticsHint`, and nothing here
 * reads a `redactFields` at all.
 *
 * So the refusal named a field and said to pass it on an object, and passing it does nothing. That
 * is the failure `format.ts` reserves its strongest wording for — "the one option in this package
 * whose silent failure sends a person's name somewhere it should not go" — reached by following
 * edfcore's own advice. `assertRedactableFields` exists precisely so a name outside the vocabulary
 * "is refused rather than ignored", and this sent readers around it.
 *
 * The consequence was backwards too. This formatter withholds by DEFAULT: `includePatientId` is
 * opt-in and read as `=== true`, so an array in the options slot leaves the identification OUT, not
 * in. The bare-value guard three lines below has always said so — "the identification lines would
 * have been left out and the summary would look exactly like one that never asked for them" — and
 * the array branch said "nothing was withheld", which is the same sentence pointing the other way.
 *
 * Two copies of one fact that disagreed, in one function, about which direction a person's name
 * leaks. This pins that they agree, and that the message says where redaction actually lives.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatHeader } from '../../src/format-header.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { FormatHeaderOptions } from '../../src/types.js';
import { minimalEdf } from '../support/writer.js';

const format = formatHeader as unknown as (header: unknown, options: unknown) => string;

const refusal = (options: unknown): string => {
  const bytes = minimalEdf();
  const header = parseHeader(bytes, bytes.byteLength);
  try {
    format(header, options);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

describe('the array refusal', () => {
  it('names only the options this call has', () => {
    const message = refusal([]);
    expect(message).toContain('includePatientId and diagnosticsHint');
    expect(message).toContain('are fields on the options');
  });

  it('does not send a reader to an option that would do nothing', () => {
    const message = refusal([]);
    expect(message).not.toMatch(/and redactFields are fields on the options/);
    expect(message).toContain('Redaction is not an option here');
  });

  it('says where redaction does live', () => {
    expect(refusal([])).toContain('formatDiagnostics()');
  });
});

describe('the direction a name leaks', () => {
  it('is the same in both copies of the sentence', () => {
    for (const options of [[] as unknown, 20, 'includePatientId']) {
      expect(refusal(options)).toContain('left out');
    }
  });

  it('is the direction the code actually takes: omitted unless asked for', () => {
    const bytes = minimalEdf();
    const header = parseHeader(bytes, bytes.byteLength);
    const withoutOptions = formatHeader(header);
    const asked = formatHeader(header, { includePatientId: true } as FormatHeaderOptions);
    expect(asked.length).toBeGreaterThan(withoutOptions.length);
    // An array reads as no options at all, which is the summary that withholds.
    expect(() => format(header, [])).toThrow();
  });
});

describe('the option the advice used to name', () => {
  it('is genuinely not read here, so passing it changes nothing', () => {
    const bytes = minimalEdf();
    const header = parseHeader(bytes, bytes.byteLength);
    const plain = formatHeader(header, { includePatientId: true } as FormatHeaderOptions);
    const withRedaction = format(header, {
      includePatientId: true,
      redactFields: ['patientId'],
    });
    expect(withRedaction).toBe(plain);
  });

  it('is read, and checked, by the formatter the message now names', async () => {
    const recording = await openEdf(byteSource(minimalEdf()));
    expect(() =>
      (formatDiagnostics as unknown as (d: unknown, o: unknown) => string)(
        recording.header.diagnostics,
        { redactFields: ['patinetId'] },
      ),
    ).toThrow(/not a field any edfcore diagnostic reports/);
  });
});
