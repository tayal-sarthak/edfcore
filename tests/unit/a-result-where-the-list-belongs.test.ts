/**
 * The query family handed the result object instead of the list inside it.
 *
 * `readAnnotations` resolves to `{ annotations, recordOnsetTicks, diagnostics }`, so the whole
 * result is what a caller has in hand and `filterAnnotationsByTime(result, window)` is the call the
 * variable name suggests. It reached `annotations.filter` and threw V8's "annotations.filter is not
 * a function"; `countAnnotationsByText` walks its argument instead and said "annotations is not
 * iterable". Neither named the argument, and neither mentioned the one field that fixes it.
 *
 * `summarizeDiagnostics` had the same shape with the other list. 0.6.95 did this for the two
 * formatters, whose `''` is an answer; these four throw, so the cost was a message rather than a
 * wrong result — the same argument, four functions over (fixed in 0.6.107).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  annotationsAt,
  countAnnotationsByText,
  filterAnnotationsByText,
  filterAnnotationsByTime,
} from '../../src/annotations-query.js';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation, EdfAnnotationsResult, EdfDiagnostic } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 1 ? [{ onset: 1, texts: ['Sleep stage W'] }] : []),
    },
  ],
});

let result: EdfAnnotationsResult;

beforeAll(async () => {
  result = await readAnnotations(await openEdf(byteSource(BYTES)), { start: 0, count: 4 });
});

/** The cast a JavaScript caller does not need to write. */
const asList = (value: unknown) => value as readonly EdfAnnotation[];

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

const CALLS: ReadonlyArray<readonly [string, (list: readonly EdfAnnotation[]) => unknown]> = [
  [
    'filterAnnotationsByTime',
    (list) => filterAnnotationsByTime(list, { startSeconds: 0, durationSeconds: 2 }),
  ],
  ['filterAnnotationsByText', (list) => filterAnnotationsByText(list, 'Sleep stage W')],
  ['countAnnotationsByText', (list) => countAnnotationsByText(list)],
  ['annotationsAt', (list) => annotationsAt(list, 1)],
];

describe.each(CALLS)('%s', (name, call) => {
  it('names itself and points at the field inside the result', () => {
    const message = refusal(() => call(asList(result)));
    expect(message).toContain(`${name}(): the annotations are an object, not an array`);
    expect(message).toContain('readAnnotations(recording, records)');
    expect(message).toContain('a result object rather than the list itself');
  });

  it('says nothing about an internal name', () => {
    const message = refusal(() => call(asList(result)));
    expect(message).not.toContain('is not iterable');
    expect(message).not.toContain('is not a function');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['one annotation rather than a list', { text: 'Sleep stage W' }],
  ])('refuses %s', (_described, given) => {
    expect(refusal(() => call(asList(given)))).toContain('not an array');
  });

  it('still works on the list itself', () => {
    expect(() => call(result.annotations)).not.toThrow();
  });
});

describe('the list really is in there', () => {
  it('so the guard is refusing a reachable mistake rather than an empty one', () => {
    expect(result.annotations).toHaveLength(1);
    expect(countAnnotationsByText(result.annotations)).toEqual([
      { text: 'Sleep stage W', count: 1 },
    ]);
  });
});

describe('summarizeDiagnostics', () => {
  it('refuses a non-array rather than walking it', () => {
    const message = refusal(() =>
      summarizeDiagnostics(result as unknown as readonly EdfDiagnostic[]),
    );
    expect(message).toContain('summarizeDiagnostics(): the diagnostics are not an array');
    expect(message).toContain('Next: pass header.diagnostics');
  });

  it('still summarises a real list', () => {
    expect(summarizeDiagnostics(result.diagnostics).total).toBe(result.diagnostics.length);
  });
});
