/**
 * The `EdfAnnotation` example on `api-types.md`, and which field it points at.
 *
 * The fence listed `onsetTicks` with the comment "compare with this", and did not list
 * `onsetTicksFromFirstRecord` at all. The table four lines below it says the opposite: the
 * rebased field is "the axis `readWindow`, `readEnvelope` and `segment.startTicks` use", and
 * `types.ts` calls `onsetTicks` "the wrong one for comparing an annotation against a window".
 *
 * This is the same defect 0.6.56 fixed in `tal/annotations.ts`, in the place a reader copies
 * from rather than the place they read (fixed in 0.6.77).
 *
 * The example compounded it: both fields print `15000000n` there, because that file declares no
 * sub-second start offset — which is most files, and exactly why an example is the worst place to
 * learn which to use. The two differ by that offset on the files that carry one, and this test
 * builds one of those.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-types.md') ?? '';

/** The example's file: no offset, so the two tick fields agree. */
const NO_OFFSET = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (record) => [{ onset: record + 0.5, texts: ['Lights off'] }] },
  ],
});

/** The same file with a quarter-second start offset, where they cannot agree. */
const WITH_OFFSET = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  startOffsetSeconds: 0.25,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (record) => [{ onset: record + 0.5, texts: ['Lights off'] }] },
  ],
});

async function firstEvent(bytes: Uint8Array) {
  const recording = await openEdf(byteSource(bytes));
  const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
  const [event] = annotations;
  if (event === undefined) throw new Error('that file carried no annotations');
  return event;
}

describe('the two tick fields', () => {
  it('agree on a file with no start offset, which is what the example shows', async () => {
    const event = await firstEvent(NO_OFFSET);
    expect(event.onsetTicks).toBe(event.onsetTicksFromFirstRecord);
  });

  it('disagree on one that declares an offset', async () => {
    const event = await firstEvent(WITH_OFFSET);
    expect(event.onsetTicks).not.toBe(event.onsetTicksFromFirstRecord);
    expect(event.onsetTicks - event.onsetTicksFromFirstRecord).toBe(2_500_000n);
  });
});

describe('the example', () => {
  it('no longer points at the header axis for a comparison', () => {
    expect(PAGE).not.toContain(
      'event.onsetTicks;                   // 15000000n — compare with this',
    );
  });

  it('lists the rebased field, and says what to compare with it', () => {
    expect(PAGE).toContain('event.onsetTicksFromFirstRecord;');
    expect(PAGE.replace(/\s+/g, ' ')).toContain('compare a window with THIS one');
  });

  it('says why the two agree in the example itself', () => {
    expect(PAGE.replace(/\s+/g, ' ')).toContain(
      'equal above because this file declares no sub-second start offset',
    );
  });

  it('still has the table it was disagreeing with', () => {
    expect(PAGE).toContain('the axis `readWindow`, `readEnvelope` and `segment.startTicks` use');
  });
});
