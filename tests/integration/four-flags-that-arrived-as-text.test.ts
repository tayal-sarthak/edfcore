/**
 * The three printers' flags, given as text.
 *
 * Every flag in this package is resolved by comparing against a boolean rather than coercing, which
 * is the right way to read one and therefore a silent one. 0.6.182 closed this for `strict` and
 * 0.6.193 for `scanSamples`; these four are the rest.
 *
 * They do not all fail in the same direction, which is why each is named:
 *
 * - `color` and `includeChannel` are read as `=== true`, so `'true'` out of a `--color` flag or a
 *   config key means OFF, and the report or the column a caller asked for simply is not there;
 * - `includePatientId` is read as `=== true` too, and points the other way by design — a formatted
 *   header is "something people paste into issues and logs", so text leaves the identification out
 *   of a report that asked for it;
 * - `diagnosticsHint` is the one read as `!== false`, so text turns it ON: `'false'` printed the
 *   hint line under a report that was suppressing it. `edfcore header` passes `false` precisely
 *   because it prints that detail itself one line below.
 *
 * Text is how all four arrive: these are the options a CLI flag, a query parameter and a JSON or
 * YAML config key set.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation, EdfDiagnostic, EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r}`] }] },
  ],
});

async function pieces(): Promise<{
  header: EdfHeader;
  diagnostics: readonly EdfDiagnostic[];
  annotations: readonly EdfAnnotation[];
}> {
  const recording = await openEdf(byteSource(FILE));
  return {
    header: recording.header,
    diagnostics: recording.header.diagnostics,
    annotations: (await readAnnotations(recording, { start: 0, count: 4 })).annotations,
  };
}

const AS_TEXT: ReadonlyArray<readonly [string, unknown]> = [
  ['the string "true"', 'true'],
  ['the string "false"', 'false'],
  ['the number 1', 1],
  ['the number 0', 0],
];

describe.each(AS_TEXT)('a flag given as %s', (_name, value) => {
  it('is refused by formatDiagnostics', async () => {
    const { diagnostics } = await pieces();
    let thrown: Error | undefined;
    try {
      formatDiagnostics(diagnostics, { color: value } as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the report printed with the flag dropped').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('options.color must be true or false');
    expect(thrown?.message).toContain('printed without colour');
  });

  it('is refused by formatHeader, for the flag that points each way', async () => {
    const { header } = await pieces();
    expect(() => formatHeader(header, { includePatientId: value } as never)).toThrow(
      /options.includePatientId must be true or false/,
    );
    expect(() => formatHeader(header, { diagnosticsHint: value } as never)).toThrow(
      /options.diagnosticsHint must be true or false/,
    );
  });

  it('is refused by formatAnnotations', async () => {
    const { annotations } = await pieces();
    expect(() => formatAnnotations(annotations, { includeChannel: value } as never)).toThrow(
      /options.includeChannel must be true or false/,
    );
  });

  it('says what the silent reading actually did', async () => {
    const { header } = await pieces();
    const thrown = ((): Error | undefined => {
      try {
        formatHeader(header, { diagnosticsHint: value } as never);
        return undefined;
      } catch (error) {
        return error as Error;
      }
    })();
    // `diagnosticsHint` is read as `!== false`, so text turned it ON rather than off.
    expect(thrown?.message).toContain('printed under a report that suppressed it');
    expect(thrown?.message).toContain('arrive as text');
  });
});

describe('the booleans themselves', () => {
  it('still colour, or not', async () => {
    const { diagnostics } = await pieces();
    expect(formatDiagnostics(diagnostics, { color: true })).toContain('[');
    expect(formatDiagnostics(diagnostics, { color: false })).not.toContain('[');
    expect(formatDiagnostics(diagnostics)).not.toContain('[');
  });

  it('still include the identification, or not', async () => {
    const { header } = await pieces();
    const shown = formatHeader(header, { includePatientId: true });
    const hidden = formatHeader(header);
    expect(shown.length).toBeGreaterThan(hidden.length);
  });

  it('still suppress the hint, which edfcore header relies on', async () => {
    const { header } = await pieces();
    expect(formatHeader(header, { diagnosticsHint: false })).not.toContain('formatDiagnostics');
    expect(formatHeader(header)).toContain('formatDiagnostics');
  });

  it('still list the channel column, or not', async () => {
    const { annotations } = await pieces();
    expect(formatAnnotations(annotations, { includeChannel: true })).toContain('event 0');
    expect(formatAnnotations(annotations, { includeChannel: false })).toContain('event 0');
  });

  it('are still fine when omitted, and when explicitly undefined', async () => {
    const { header, diagnostics, annotations } = await pieces();
    expect(() => formatHeader(header, { includePatientId: undefined } as never)).not.toThrow();
    expect(() => formatDiagnostics(diagnostics, { color: undefined } as never)).not.toThrow();
    expect(() =>
      formatAnnotations(annotations, { includeChannel: undefined } as never),
    ).not.toThrow();
  });
});
