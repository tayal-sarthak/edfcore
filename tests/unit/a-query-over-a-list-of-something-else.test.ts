/**
 * The four annotation queries given an array of something else.
 *
 * `assertAnnotations` is shared by `filterAnnotationsByTime`, `filterAnnotationsByText`,
 * `countAnnotationsByText` and `annotationsAt`, and it stopped at `Array.isArray`. Being an array
 * says nothing about what is in it.
 *
 * Three of the four then ANSWERED. `filterAnnotationsByText` and `annotationsAt` returned `[]` —
 * which means "no event matches", said of a list holding no events at all — and
 * `countAnnotationsByText` returned a single row counting `undefined`. Only `filterAnnotationsByTime`
 * failed, with V8's `Cannot mix BigInt and other types, use explicit conversions` out of the tick
 * comparison: a sentence about types, naming no argument.
 *
 * The three PRINTERS closed this one at a time — `formatDiagnostics` in 0.6.160,
 * `summarizeDiagnostics` in 0.6.168 and `formatAnnotations` in 0.6.185 — each checking the one field
 * its own rows must carry. These four queries share one guard and are the rest of the set.
 *
 * `header.diagnostics` and `timeline.diagnostics` are the lists that get passed: they are the other
 * arrays a reader holds after opening a file, and their printers sit beside these four in the barrel.
 */

import { describe, expect, it } from 'vitest';
import {
  annotationsAt,
  countAnnotationsByText,
  filterAnnotationsByText,
  filterAnnotationsByTime,
} from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import type { EdfAnnotation, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r}`] }] },
  ],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

type Call = (list: unknown) => unknown;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  [
    'filterAnnotationsByTime',
    (list) => filterAnnotationsByTime(list as never, { startSeconds: 0, durationSeconds: 4 }),
  ],
  ['filterAnnotationsByText', (list) => filterAnnotationsByText(list as never, 'event 0')],
  ['countAnnotationsByText', (list) => countAnnotationsByText(list as never)],
  ['annotationsAt', (list) => annotationsAt(list as never, 1)],
];

async function wrongLists(): Promise<ReadonlyArray<readonly [string, unknown]>> {
  const recording = await opened();
  const index = await buildRecordIndex(recording);
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
  });
  return [
    ['header.diagnostics', recording.header.diagnostics],
    ['header.signals', recording.header.signals],
    ['chunk.signals', chunks[0]?.signals],
    ['index.segments', index.segments],
  ];
}

describe.each(CALLS)('%s, given an array of the wrong thing', (_name, call) => {
  it('is refused rather than answered', async () => {
    for (const [what, list] of await wrongLists()) {
      let thrown: Error | undefined;
      try {
        call(list);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown, `${what} was answered`).toBeDefined();
      expect(thrown, what).toBeInstanceOf(RangeError);
      expect(thrown, what).not.toBeInstanceOf(TypeError);
      expect(thrown?.message, what).toContain('carries no onset');
      expect(thrown?.message, what).toContain('Next:');
    }
  });

  it('says why an answer would be worse than a failure', async () => {
    const list = (await wrongLists())[0]?.[1];
    expect(() => call(list)).toThrow(/reads as a recording with nothing in it/);
  });

  it('no longer reports the type mismatch instead of the argument', async () => {
    const list = (await wrongLists())[0]?.[1];
    let thrown: Error | undefined;
    try {
      call(list);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).not.toContain('Cannot mix BigInt');
  });

  it('still answers for a real list of annotations', async () => {
    const recording = await opened();
    const events = (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
    expect(call(events)).toBeDefined();
  });

  it('still answers for an empty list, which is a recording with no events', () => {
    expect(call([])).toEqual([]);
  });

  it('keeps the 0.6.107 refusal for the result object rather than the list', async () => {
    const recording = await opened();
    const result = await readAnnotations(recording, { start: 0, count: 4 });
    expect(() => call(result)).toThrow(/not an array/);
  });
});

describe('a list that goes wrong after the first row', () => {
  it('is still accepted, because the check is on the first element', async () => {
    // Recorded, not endorsed: the printers check every row they print and these check the one they
    // can check for free. A homogeneous list is what every producer here returns.
    const recording = await opened();
    const events = (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
    const mixed = [events[0] as EdfAnnotation, { text: 'not an event' }];
    expect(() => countAnnotationsByText(mixed as never)).not.toThrow();
  });
});
