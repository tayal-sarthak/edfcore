/**
 * The annotation helpers agree with each other, on every awkward shape — without the corpus.
 *
 * The last group in `tests/corpus/whole-api.test.ts`, which skips without `npm run corpus:fetch`.
 * Four helpers describe one list, and each can be right on its own while contradicting the others:
 * a census that loses an event, a formatter that emits a line for something the list does not
 * hold, a time filter that misses an event sitting exactly on the instant it was asked about.
 *
 * The last of those is the one worth stating. `annotationsAt(list, t)` and a window of width
 * 0.001 s starting at `t` must both return an event whose onset IS `t`, which is a claim about
 * where the boundary of a half-open interval falls — and half-open boundaries were where five of
 * the comparisons this project has had to fix went wrong. Asking every event about its own onset
 * puts every one of them on a boundary rather than hoping one lands there.
 *
 * The shapes matter here too: one file has a zero record duration, where every event has a real
 * onset and no rate exists to derive it from, and one has no data signals at all, where the whole
 * file is annotations. Both are ordinary EDF+ and neither was reachable on a fresh clone.
 *
 * What this does NOT check: the onsets themselves, or the sort order. `tal/annotations.test.ts`
 * and `onset-fields.test.ts` own those. This checks that four helpers describe one list.
 */

import { describe, expect, it } from 'vitest';
import {
  annotationsAt,
  byteSource,
  countAnnotationsByText,
  filterAnnotationsByText,
  filterAnnotationsByTime,
  formatAnnotations,
  openEdf,
  readAnnotations,
} from '../../src/index.js';
import type { EdfAnnotation } from '../../src/types.js';
import { AWKWARD } from '../support/awkward-files.js';

async function annotationsOf(bytes: Uint8Array): Promise<readonly EdfAnnotation[]> {
  const recording = await openEdf(byteSource(bytes));
  const { annotations } = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  return annotations;
}

let eventsChecked = 0;
let filesWithEvents = 0;

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  it(`describes one list four ways, where ${awkward}`, async () => {
    const annotations = await annotationsOf(bytes);
    if (annotations.length > 0) filesWithEvents += 1;

    // The census accounts for every annotation exactly once.
    const census = countAnnotationsByText(annotations);
    expect(census.reduce((sum, entry) => sum + entry.count, 0)).toBe(annotations.length);
    expect(new Set(census.map((entry) => entry.text)).size).toBe(census.length);
    // And it agrees with the filter about each text it names.
    for (const entry of census) {
      expect(filterAnnotationsByText(annotations, entry.text), entry.text).toHaveLength(
        entry.count,
      );
    }

    // The formatter emits one line per annotation, and nothing at all for none.
    const text = formatAnnotations(annotations);
    expect(text === '' ? 0 : text.split('\n').length).toBe(annotations.length);

    // Every event is found by a window that starts at its own onset, and by `annotationsAt` at it.
    // Each event therefore sits on the boundary of the interval it is being looked for in.
    for (const event of annotations) {
      const at = event.onsetSecondsFromFirstRecord;
      expect(
        filterAnnotationsByTime(annotations, { startSeconds: at, durationSeconds: 0.001 }),
        `${event.text} at ${at}`,
      ).toContain(event);
      expect(annotationsAt(annotations, at), `${event.text} at ${at}`).toContain(event);
      eventsChecked += 1;
    }
  });
});

describe('the run reached real events', () => {
  it('checked events on more than one file, or the agreement was between empty lists', () => {
    // Four of the shapes carry no annotations channel at all. Two empty lists agree about
    // everything, so the counts are what make the run above mean something.
    expect(filesWithEvents).toBeGreaterThanOrEqual(3);
    expect(eventsChecked).toBeGreaterThanOrEqual(10);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the sixteen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(16);
  });
});
