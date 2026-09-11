/**
 * How the inspector decides which events fall in the window it is drawing.
 *
 * It compared `annotation.onsetSecondsFromFirstRecord` against the window bounds directly.
 * `annotations-query.ts` exists for that comparison and quotes the expression that was there:
 * "The obvious filter is `a.onsetSecondsFromFirstRecord >= from && … < to`, and those are float64
 * seconds converted from exact tick counts. An onset stored as `+30.0000001` and a bound of
 * `30.0000001` need not compare equal once both have been through a division by 10,000,000."
 *
 * It is mistake 4 on `AGENTS.md` — "Compare event times in `bigint` ticks, not the floats" — made
 * on the page that draws the events and the samples on one axis (fixed in 0.6.81).
 *
 * Two differences, not one. The bounds are converted to ticks once and compared exactly; and the
 * window is HALF-OPEN, so an event landing exactly on the right edge belongs to the next window
 * rather than to both. The hand-written test used `<=` at that edge and double-counted it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const DEMO = readFileSync(new URL('../../website/src/pages/demo.astro', import.meta.url), 'utf8');

/** One event per second, on the second, so a window edge lands exactly on one. */
const FILE = buildEdf({
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (record) => [{ onset: record, texts: [`e${record}`] }] },
  ],
});

async function events() {
  const recording = await openEdf(byteSource(FILE));
  const { annotations } = await readAnnotations(recording, { start: 0, count: 8 });
  return annotations;
}

describe('an event exactly on the right edge of a window', () => {
  it('is excluded, because the window is half-open', async () => {
    const inWindow = filterAnnotationsByTime(await events(), {
      startSeconds: 2,
      durationSeconds: 2,
    });
    expect(inWindow.map((event) => event.text)).toEqual(['e2', 'e3']);
  });

  it('is what the old comparison included, so adjacent windows double-counted it', async () => {
    const start = 2;
    const duration = 2;
    const byFloat = (await events()).filter((event) => {
      const onset = event.onsetSecondsFromFirstRecord;
      return onset >= start && onset <= start + duration;
    });
    expect(byFloat.map((event) => event.text)).toEqual(['e2', 'e3', 'e4']);
  });

  it('belongs to exactly one of two adjacent windows', async () => {
    const all = await events();
    const first = filterAnnotationsByTime(all, { startSeconds: 0, durationSeconds: 4 });
    const second = filterAnnotationsByTime(all, { startSeconds: 4, durationSeconds: 4 });
    const texts = [...first, ...second].map((event) => event.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('the inspector', () => {
  it('asks the library which events are in the window', () => {
    expect(DEMO).toContain('filterAnnotationsByTime(annotations, {');
  });

  it('no longer compares the float seconds against the bounds itself', () => {
    expect(DEMO).not.toContain('onset < startSeconds || onset > startSeconds + durationSeconds');
  });
});
