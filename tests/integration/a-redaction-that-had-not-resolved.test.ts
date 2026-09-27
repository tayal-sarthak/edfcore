/**
 * The listing options handed over as the Promise that will produce them.
 *
 * 0.6.258 and 0.6.259 closed the read and parse halves of this shape. This is the family where the
 * option that goes missing is `redactFields`, and `format.ts` states what that costs in the strongest
 * terms this package uses: it is "the one option in this package whose silent failure sends a person's
 * name somewhere it should not go".
 *
 * Both options go at the same time, because both are read off the object rather than awaited. So a
 * call asking for twenty rows with the identification withheld printed every row it had, with the
 * identification in them — and the `... and N more` line that would have shown the truncation was
 * absent too, because there was none.
 *
 * The route is a caller's own async helper: a redaction policy out of a config file, a session record,
 * or a per-user setting. That is exactly the kind of place a redaction list lives, which is what makes
 * this family's Promise worse than the read family's: there the defaults cost memory and
 * cancellation, here they cost a name.
 *
 * `assertRedactableFields` exists so a name outside the vocabulary "is refused rather than ignored".
 * A pending Promise has no names in it at all, so that guard saw an empty list and had nothing to
 * refuse.
 *
 * A property read, never a call. A Promise that never settles is refused rather than awaited.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfAnnotation, ValidationReport } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdfPlus } from '../support/writer.js';

const bytes = minimalEdfPlus();

const EVENTS = Array.from({ length: 40 }, (_, i) => ({
  onsetTicks: BigInt(i) * 10000000n,
  onsetSeconds: i,
  onsetTicksFromFirstRecord: BigInt(i) * 10000000n,
  onsetSecondsFromFirstRecord: i,
  durationTicks: undefined,
  durationSeconds: undefined,
  text: `Event ${i}`,
  channel: undefined,
  channelLabel: undefined,
  recordIndex: 0,
  isTimekeeping: false,
})) as unknown as readonly EdfAnnotation[];

/** What a caller's own async policy lookup hands back if the await is left off. */
const pendingOptions = (): unknown =>
  Promise.resolve({ maxItems: 20, redactFields: ['patientId', 'recordingId'] });

type Formatter = (subject: unknown, options: unknown) => string;

describe.each([
  ['formatAnnotations', formatAnnotations as unknown as Formatter, EVENTS, 'annotation'],
] as const)('%s', (_name, format, subject, listed) => {
  it('is refused rather than listing everything unredacted', () => {
    expect(() => format(subject, pendingOptions())).toThrow(RangeError);
  });

  it('names both options and what their defaults did', () => {
    let message = '';
    try {
      format(subject, pendingOptions());
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('the options are a pending Promise');
    expect(message).toContain('maxItems and redactFields are read off the object');
    expect(message).toContain(`every ${listed} was listed`);
    expect(message).toContain('Next: await them');
  });
});

describe('every listing formatter', () => {
  it('refuses it, since all three resolve these options the same way', async () => {
    const recording = await openEdf(byteSource(bytes));
    const report: ValidationReport = await validateRecording(recording);
    const calls: ReadonlyArray<readonly [string, () => string]> = [
      [
        'formatDiagnostics',
        () =>
          (formatDiagnostics as unknown as Formatter)(
            recording.header.diagnostics,
            pendingOptions(),
          ),
      ],
      [
        'formatAnnotations',
        () => (formatAnnotations as unknown as Formatter)(EVENTS, pendingOptions()),
      ],
      [
        'formatValidationReport',
        () => (formatValidationReport as unknown as Formatter)(report, pendingOptions()),
      ],
    ];
    for (const [name, call] of calls) {
      expect(call, name).toThrow(/the options are a pending Promise/);
    }
  });
});

describe('the truncation that would have hidden it', () => {
  it('was absent, because nothing was truncated', () => {
    // What the old behaviour produced: every row, and no line saying rows were withheld.
    expect(() => (formatAnnotations as unknown as Formatter)(EVENTS, pendingOptions())).toThrow();
    const asked = formatAnnotations(EVENTS, { maxItems: 20 });
    expect(asked).toContain('... and 20 more');
  });
});

describe('the Promise itself', () => {
  it('is never awaited, settled or subscribed to', () => {
    const neverSettles = new Promise<never>(() => {});
    expect(() => (formatAnnotations as unknown as Formatter)(EVENTS, neverSettles)).toThrow(
      /a pending Promise/,
    );
  });
});

describe('the options that were always right', () => {
  it('still truncate and still redact', async () => {
    const options = await (pendingOptions() as Promise<{
      maxItems: number;
      redactFields: readonly string[];
    }>);
    expect(formatAnnotations(EVENTS, { maxItems: options.maxItems })).toContain('... and 20 more');
    const recording = await openEdf(byteSource(bytes));
    expect(() =>
      (formatDiagnostics as unknown as Formatter)(recording.header.diagnostics, options),
    ).not.toThrow();
  });

  it('are still optional', () => {
    expect(formatAnnotations(EVENTS)).toContain('Event 0');
    expect(formatAnnotations(EVENTS, undefined)).toContain('Event 0');
  });
});

describe('the branches that were already there', () => {
  it('keep their own sentences', () => {
    expect(() => (formatAnnotations as unknown as Formatter)(EVENTS, [20])).toThrow(
      /the options are an array/,
    );
    expect(() => (formatAnnotations as unknown as Formatter)(EVENTS, 20)).toThrow(/not an object/);
  });
});
