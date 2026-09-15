/**
 * The last window object in the package, and the route into it an array still had.
 *
 * `filterAnnotationsByTime` is, by its own comment, "the one function left in the package that
 * takes a window object". 0.6.79 made the argument for the reading API and 0.6.98 finished it
 * there; 0.6.167 then closed the gap those left — an array is an object, so it walks past a check
 * that asks only whether the value is one, and "each call named whichever field it happened to read
 * first". That release covered the selection. This is the window.
 *
 * The array a caller has is supplied by the neighbour this function is documented against.
 * `resolveTimeWindow(timeline, index, startSeconds, durationSeconds)` is named for the window and
 * returns the RECORD RANGES the window maps to, and the docblock at the top of this module says the
 * bounds here are "the same seconds `resolveTimeWindow` and `readWindow` take" — so
 * `const window = resolveTimeWindow(...)` followed by `filterAnnotationsByTime(annotations, window)`
 * is the call those two sentences invite.
 *
 * What it got was advice about `window.startSeconds`: "an object whose bounds are spelled something
 * else", which asks a reader to go and rename fields on a value that has no fields at all. That
 * clause is right for the case 0.6.158 wrote it for and wrong for this one, which is the reason the
 * shape has to be named rather than left to the bound that happens to be read first.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime, resolveTimeWindow } from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function annotations(): Promise<readonly EdfAnnotation[]> {
  const recording = await openEdf(byteSource(FILE));
  return (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
}

const filter = (list: readonly EdfAnnotation[], window: unknown): readonly EdfAnnotation[] =>
  (filterAnnotationsByTime as unknown as (a: unknown, w: unknown) => readonly EdfAnnotation[])(
    list,
    window,
  );

describe('the record ranges a window maps to, passed as the window', () => {
  it('is refused as an array, not as a window missing a bound', async () => {
    const recording = await openEdf(byteSource(FILE));
    const ranges = resolveTimeWindow(recording.timeline, recording.index, 0, 2);
    expect(ranges.length).toBeGreaterThan(0);
    const list = await annotations();
    // Both spellings throw a RangeError; only one of them says what was actually passed.
    expect(() => filter(list, ranges)).toThrow(/the window is an array/);
  });

  it('names the array and the call that produced it, not a missing bound', async () => {
    const list = await annotations();
    try {
      filter(list, [{ start: 0, count: 2 }]);
      expect.unreachable('a list of record ranges must not be taken as a time window');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('the window is an array');
      expect(message).toContain('resolveTimeWindow');
      // The clause 0.6.158 wrote for a bound that is genuinely absent. Here it would send the
      // reader to rename fields on a value that has none.
      expect(message).not.toContain('startSeconds must be');
      expect(message).not.toContain('spelled something else');
    }
  });

  it('refuses a bare pair of bounds too, which is the other array a caller reaches for', async () => {
    const list = await annotations();
    expect(() => filter(list, [0, 2])).toThrow(/the window is an array/);
  });

  it('still filters by a real window', async () => {
    const list = await annotations();
    expect(() =>
      filterAnnotationsByTime(list, { startSeconds: 0, durationSeconds: 2 }),
    ).not.toThrow();
  });
});
