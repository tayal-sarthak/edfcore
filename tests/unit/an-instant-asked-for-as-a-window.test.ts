/**
 * `annotationsAt` and `filterAnnotationsByTime`, each given what the other takes.
 *
 * They differ in one thing: an instant or an interval. `annotationsAt` exists BECAUSE of that
 * difference, and its docblock says so — the window form "works — a zero-length window — except
 * that `filterAnnotationsByTime` returns nothing for a non-positive duration, so the obvious call
 * returns an empty list at every position". Neither refusal named the other.
 *
 * The number-where-a-window-belongs direction is the costly one, because its advice was
 * followable. "Pass a window carrying startSeconds and durationSeconds", said to someone holding a
 * cursor position, is answered with `{ startSeconds: t, durationSeconds: 0 }` — a window over one
 * instant has no length — and that returns `[]` at every position, silently, at the call a viewer
 * makes on every mouse move. The sibling that takes the number is one export away.
 *
 * The window-where-an-instant-belongs direction reached `secondsToTicks`, which answered "seconds
 * must be a number of seconds, and was given an object. Next: convert it first". There is no
 * conversion — a window is not a number spelled differently — so that advice asked the reader to
 * invent one.
 *
 * 0.6.88 made this argument for `readWindow` and `readRecords`, the other pair in this package
 * that differ only in the unit they bound by, and its comment names the second direction "the
 * OTHER WAY". Both are closed here.
 *
 * Every other wrong window keeps the refusal it had, and neither function's answer changes.
 */

import { describe, expect, it } from 'vitest';
import { annotationsAt, filterAnnotationsByTime } from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** One half-second event per record, so an instant inside one has an answer. */
const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (r) => [{ onset: r + 0.25, texts: [`e${r}`], duration: 0.5 }],
    },
  ],
});

const CURSOR = 2.25;

async function events(): Promise<readonly EdfAnnotation[]> {
  const recording = await openEdf(byteSource(FILE));
  return (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
}

const refusal = async (call: (list: readonly EdfAnnotation[]) => unknown): Promise<Error> => {
  const list = await events();
  let thrown: Error | undefined;
  try {
    call(list);
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('the trap the old advice led to', () => {
  it('is real: a zero-length window finds nothing where an event actually is', async () => {
    const list = await events();
    expect(
      filterAnnotationsByTime(list, { startSeconds: CURSOR, durationSeconds: 0 }),
    ).toHaveLength(0);
    expect(annotationsAt(list, CURSOR)).toHaveLength(1);
  });
});

describe('an instant where the window belongs', () => {
  it.each([
    ['a whole number', 2],
    ['a fraction', CURSOR],
    ['zero', 0],
  ])('names the call that takes it, for %s', async (_shape, seconds) => {
    const thrown = await refusal((list) => filterAnnotationsByTime(list, seconds as never));
    expect(thrown.message).toContain('annotationsAt(annotations, seconds)');
  });

  it('says why a window cannot express it', async () => {
    const thrown = await refusal((list) => filterAnnotationsByTime(list, CURSOR as never));
    expect(thrown.message).toContain('That is an instant');
    expect(thrown.message).toContain('a zero-length one returns nothing');
  });

  it('still names the window fields as the other way out', async () => {
    const thrown = await refusal((list) => filterAnnotationsByTime(list, CURSOR as never));
    expect(thrown.message).toContain('startSeconds and durationSeconds');
  });

  it('stays a RangeError', async () => {
    const thrown = await refusal((list) => filterAnnotationsByTime(list, CURSOR as never));
    expect(thrown).toBeInstanceOf(RangeError);
  });
});

describe('a window where the instant belongs', () => {
  it.each([
    ['both bounds', { startSeconds: 2, durationSeconds: 1 }],
    ['only a start', { startSeconds: 2 }],
    ['only a duration', { durationSeconds: 1 }],
  ])('names the call that takes it, for a window with %s', async (_shape, window) => {
    const thrown = await refusal((list) => annotationsAt(list, window as never));
    expect(thrown.message).toContain('that is a time window');
    expect(thrown.message).toContain('filterAnnotationsByTime(annotations, window)');
  });

  it('no longer asks the reader to convert it to a number', async () => {
    const thrown = await refusal((list) =>
      annotationsAt(list, { startSeconds: 2, durationSeconds: 1 } as never),
    );
    expect(thrown.message).not.toContain('convert it first');
  });

  it('points at the field holding the instant', async () => {
    const thrown = await refusal((list) =>
      annotationsAt(list, { startSeconds: 2, durationSeconds: 1 } as never),
    );
    expect(thrown.message).toContain('window.startSeconds');
  });
});

describe('everything else is unchanged', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', '2'],
  ])('keeps the plain window refusal for %s', async (_shape, window) => {
    const thrown = await refusal((list) => filterAnnotationsByTime(list, window as never));
    expect(thrown.message).toContain('not an object');
    expect(thrown.message).not.toContain('annotationsAt');
  });

  it('keeps the array refusal, which names resolveTimeWindow', async () => {
    const thrown = await refusal((list) => filterAnnotationsByTime(list, [] as never));
    expect(thrown.message).toContain('resolveTimeWindow()');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', '2'],
    ['an object with no bounds on it', {}],
  ])('keeps the seconds refusal in annotationsAt for %s', async (_shape, seconds) => {
    const thrown = await refusal((list) => annotationsAt(list, seconds as never));
    expect(thrown.message).toContain('seconds must be a');
  });

  it('still answers both calls for what each one takes', async () => {
    const list = await events();
    expect(annotationsAt(list, CURSOR)).toHaveLength(1);
    expect(filterAnnotationsByTime(list, { startSeconds: 0, durationSeconds: 4 })).toHaveLength(4);
  });
});
