/**
 * Which onset field to compare on, asked of the three places that answer it.
 *
 * `EdfAnnotation` carries the onset on two axes. `onsetTicks` is the header's — the number the
 * file wrote. `onsetTicksFromFirstRecord` is rebased to record 0's true start, which is where
 * `resolveTimeWindow`, `readWindow`, `readEnvelope` and every chunk put `t = 0`. They differ by
 * the sub-second offset record 0's timekeeping TAL may declare, so they are equal on most files
 * and up to a second apart on the ones that carry one.
 *
 * Three places in this repository tell a reader which to use, and until 0.6.56 one of them said
 * the opposite of the other two:
 *
 * - `src/types.ts` on the field itself: "the right field for comparing one annotation against
 *   another, and the wrong one for comparing an annotation against a window".
 * - `api-helpers.md` on the query helpers: "Every comparison is on `onsetTicksFromFirstRecord`".
 * - `src/tal/annotations.ts`, the module that produces both, in the numbered list of its three
 *   load-bearing decisions: "`onsetTicks` is exact and is the only one worth comparing."
 *
 * The third is the docblock a reader hits first when they go looking for where annotations come
 * from, and it ships in `dist` as hover text. Taking it at its word puts every event a file with
 * a sub-second start offset carries up to a second away from the window it belongs to.
 *
 * The first test below is the one with teeth: it builds a file whose record 0 starts at +0.25 s
 * and shows the two fields disagreeing, so "the only one worth comparing" is a claim about a
 * difference that exists rather than a distinction without one.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const ANNOTATIONS_MODULE = read('src/tal/annotations.ts');
const TYPES_MODULE = read('src/types.ts');
const HELPERS_PAGE = (DOCS_PAGES.get('api-helpers.md') ?? '').replace(/\s+/g, ' ');

/** Record 0 starts a quarter-second in, so the two axes cannot agree. */
const OFFSET_FILE = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  startOffsetSeconds: 0.25,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => [{ onset: record + 0.75, texts: [`event ${record}`] }],
    },
  ],
});

describe('the two axes on a file that carries a sub-second start', () => {
  it('do not agree, so choosing between them is a real choice', async () => {
    const recording = await openEdf(byteSource(OFFSET_FILE));
    expect(recording.timeline.startOffsetTicks).toBe(2_500_000n);
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const [first] = annotations;
    expect(first).toBeDefined();
    expect(first?.onsetTicks).toBe(7_500_000n);
    expect(first?.onsetTicksFromFirstRecord).toBe(5_000_000n);
  });

  it('differ by exactly record 0’s offset, which is what makes the wrong one wrong', async () => {
    const recording = await openEdf(byteSource(OFFSET_FILE));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    expect(annotations.length).toBeGreaterThan(0);
    for (const annotation of annotations) {
      expect(annotation.onsetTicks - annotation.onsetTicksFromFirstRecord).toBe(
        recording.timeline.startOffsetTicks,
      );
    }
  });
});

describe('the three places that say which field to compare on', () => {
  it('has types.ts calling onsetTicks the wrong one for a window', () => {
    expect(TYPES_MODULE).toContain('the wrong one for');
    expect(TYPES_MODULE).toContain('onsetTicksFromFirstRecord');
  });

  it('has api-helpers.md putting every query helper on the rebased axis', () => {
    expect(HELPERS_PAGE).toContain('Every comparison is on `onsetTicksFromFirstRecord`');
  });

  it('no longer has the producing module recommending the header axis', () => {
    // The sentence itself is quoted in this file's own docblock and in the module's, as history.
    // What must not come back is the module ASSERTING it, which it did in its numbered list.
    const decisions = ANNOTATIONS_MODULE.slice(0, ANNOTATIONS_MODULE.indexOf('\n */'));
    expect(decisions).not.toMatch(
      /`onsetTicks` is exact\s*\n?\s*\*?\s*and is the only one worth comparing/,
    );
    expect(decisions).toContain('onsetTicksFromFirstRecord');
  });
});
