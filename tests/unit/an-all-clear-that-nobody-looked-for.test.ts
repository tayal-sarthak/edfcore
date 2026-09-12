/**
 * The two formatters whose empty string is an answer, given something that is not a list.
 *
 * `formatDiagnostics` returns `''` for a file with no problems and `formatAnnotations` returns `''`
 * for a recording with no events. Both documented that, and both computed it from
 * `argument.length` — so a wrong argument read a `length` of `undefined`, printed nothing, and
 * returned the answer that means "all clear".
 *
 * `formatDiagnostics(recording)` is the mistake worth guarding: the recording is the object a
 * reader has in hand, the diagnostics hang off `recording.header`, and the reward for reaching for
 * the wrong one was a clean bill of health for a file nobody looked at (fixed in 0.6.95).
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation, EdfDiagnostic } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (recordIndex) => (recordIndex === 1 ? [{ onset: 1, texts: ['Sleep stage W'] }] : []),
    },
  ],
});

const opened = () => openEdf(byteSource(BYTES));

const asDiagnostics = (value: unknown) => value as readonly EdfDiagnostic[];
const asAnnotations = (value: unknown) => value as readonly EdfAnnotation[];

function refusal(run: () => unknown): string {
  const result = (() => {
    try {
      return { ok: true as const, value: run() };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();
  if (result.ok) throw new Error(`the argument was accepted, and returned ${String(result.value)}`);
  return result.message;
}

describe('formatDiagnostics', () => {
  it('refuses the recording rather than reporting no problems', async () => {
    const recording = await opened();
    const message = refusal(() => formatDiagnostics(asDiagnostics(recording)));
    expect(message).toContain('formatDiagnostics(): the diagnostics are an object, not an array');
    expect(message).toContain('Next: pass header.diagnostics');
  });

  it('says why the empty string is not available as a refusal', async () => {
    const recording = await opened();
    expect(refusal(() => formatDiagnostics(asDiagnostics(recording)))).toContain(
      'for a file with no problems',
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a single diagnostic rather than a list', { code: 'X', message: 'y' }],
  ])('refuses %s', (_described, given) => {
    expect(() => formatDiagnostics(asDiagnostics(given))).toThrow(RangeError);
  });

  it('still returns the empty string for a file that really has none', () => {
    expect(formatDiagnostics([])).toBe('');
  });

  it('still formats a list that has something in it', () => {
    const diagnostic: EdfDiagnostic = {
      code: 'ANNOTATION_TEXT_NOT_UTF8',
      severity: 'warning',
      message: 'text is not UTF-8',
      field: undefined,
      byteOffset: undefined,
      byteLength: undefined,
      rawBytes: undefined,
      raw: undefined,
      expected: undefined,
      actual: undefined,
      signalIndex: undefined,
      recordIndex: undefined,
      specReference: undefined,
    };
    expect(formatDiagnostics([diagnostic])).toContain('ANNOTATION_TEXT_NOT_UTF8');
  });
});

describe('formatAnnotations', () => {
  it('refuses the recording rather than reporting no events', async () => {
    const recording = await opened();
    const message = refusal(() => formatAnnotations(asAnnotations(recording)));
    expect(message).toContain('formatAnnotations(): the annotations are an object, not an array');
    expect(message).toContain(
      'Next: pass the annotations from readAnnotations(recording, records)',
    );
  });

  it('refuses the whole result object, which is the other reach for the wrong one', async () => {
    const recording = await opened();
    const result = await readAnnotations(recording, { start: 0, count: 4 });
    expect(refusal(() => formatAnnotations(asAnnotations(result)))).toContain('not an array');
    expect(formatAnnotations(result.annotations)).not.toBe('');
  });

  it('still returns the empty string for an empty list', () => {
    expect(formatAnnotations([])).toBe('');
  });
});
