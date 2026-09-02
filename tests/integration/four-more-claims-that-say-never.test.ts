/**
 * Four more promises that say "never" or "every", executed against every shape.
 *
 * `the-page-says-always.test.ts` did this for the five on `api-reading.md` and found one sentence
 * that was true and incomplete. These four are spread over two pages and a module docblock, and
 * each is the kind of claim a reader relies on without checking:
 *
 * - `api-helpers.md`: "`matchSignals` never returns an annotations channel." A montage filter that
 *   returned one would decode a TAL region as if it were samples, which that page names as "the
 *   usual way" the mistake happens.
 * - `api-helpers.md`: "Events outside the window are never returned, even though the scan itself is
 *   record-aligned." The scan reads whole records; the answer must not.
 * - `annotations.md`: "`onsetRaw` keeps the original text, so a round-trip through edfcore never
 *   loses precision you had."
 * - `bytes/latin1.ts`: ISO-8859-1 "is the identity map onto U+0000..U+00FF", which is the whole
 *   argument for decoding header text by hand rather than with `TextDecoder`.
 *
 * All four hold, on all seventeen shapes. The one worth looking at is the first: on the file whose
 * only channel is an annotations channel, `matchSignals(/.*\/)` returns nothing at all. A helper
 * that answered "every signal" with the one signal there is would be the exact mistake the page
 * warns about, and the empty answer is the rule at its sharpest.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const HELPERS = (DOCS_PAGES.get('api-helpers.md') ?? '').replace(/\s+/g, ' ');
const ANNOTATIONS = (DOCS_PAGES.get('annotations.md') ?? '').replace(/\s+/g, ' ');

describe('the claims', () => {
  it('are still made, so a rewording fails here rather than drifting', () => {
    expect(HELPERS).toContain('`matchSignals` never returns an annotations channel.');
    expect(HELPERS).toContain('Events outside the window are never returned');
    expect(ANNOTATIONS).toContain('never loses precision you had');
  });

  it('are checked against seventeen shapes', () => {
    expect(AWKWARD).toHaveLength(17);
  });
});

describe.each(AWKWARD)('$name', ({ bytes }) => {
  it('never offers an annotations channel to a montage filter', async () => {
    const { header } = await openEdf(byteSource(bytes));
    const annotations = new Set(header.annotationSignalIndices);
    // A pattern that matches every label, which is the strongest form of the question.
    for (const signal of matchSignals(header, /.*/)) {
      expect({ label: signal.label, isAnnotations: annotations.has(signal.index) }).toEqual({
        label: signal.label,
        isAnnotations: false,
      });
    }
  });

  it('keeps every onset reparseable from the text the file wrote', async () => {
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    for (const event of annotations) {
      const fromRaw = BigInt(Math.round(Number(event.onsetRaw) * Number(TICKS_PER_SECOND)));
      expect({ raw: event.onsetRaw, ticks: fromRaw }).toEqual({
        raw: event.onsetRaw,
        ticks: event.onsetTicks,
      });
    }
  });

  it('returns no event that falls outside the window, however the scan was aligned', async () => {
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    if (annotations.length === 0) return;

    // A window narrower than a record, so a record-aligned scan must be trimmed to answer it.
    for (const window of [
      { startSeconds: 0.4, durationSeconds: 0.4 },
      { startSeconds: 1.1, durationSeconds: 0.2 },
    ]) {
      const to = window.startSeconds + window.durationSeconds;
      for (const event of filterAnnotationsByTime(annotations, window)) {
        const from = event.onsetSecondsFromFirstRecord;
        const end = from + (event.durationSeconds ?? 0);
        expect({ text: event.text, overlaps: from < to && end >= window.startSeconds }).toEqual({
          text: event.text,
          overlaps: true,
        });
      }
    }
  });
});

describe('the file whose only channel is an annotations channel', () => {
  it('answers "every signal" with none, which is the rule at its sharpest', async () => {
    const only = AWKWARD.find((file) => file.name === 'annotations only, no data signal');
    if (only === undefined) throw new Error('the matrix lost its annotations-only file');
    const { header } = await openEdf(byteSource(only.bytes));

    expect(header.signals).toHaveLength(1);
    expect(header.annotationSignalIndices).toHaveLength(1);
    // Returning the one signal there is would be exactly the mistake the page warns about.
    expect(matchSignals(header, /.*/)).toEqual([]);
  });
});

describe('the decoder that argument rests on', () => {
  it('maps all 256 bytes to 256 distinct characters, one each', () => {
    const every = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const text = decodeHeaderLatin1(every);
    expect(text).toHaveLength(256);
    for (const [at, character] of [...text].entries()) {
      expect({ at, code: character.codePointAt(0) }).toEqual({ at, code: at });
    }
  });

  it('does the same across the chunk boundary the decoder splits on', () => {
    // 4096 bytes at a time, so a file with a maximal header crosses it hundreds of times.
    const long = Uint8Array.from({ length: 10_000 }, (_, at) => at % 256);
    const text = decodeHeaderLatin1(long);
    expect(text).toHaveLength(10_000);
    expect(text.codePointAt(4095)).toBe(4095 % 256);
    expect(text.codePointAt(4096)).toBe(4096 % 256);
  });
});
