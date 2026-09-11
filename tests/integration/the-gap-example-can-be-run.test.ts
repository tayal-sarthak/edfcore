/**
 * The landing page's gap example, run against the file it describes.
 *
 * It called `readWindow(recording, …)` on a discontinuous recording and then read
 * `chunks[1].precededByGap`. Neither line works on the index it was holding: `readWindow` across a
 * gap THROWS on the probed index `openEdf` returns, because two probes cannot say where the hole
 * is, and `precededByGap` is documented as "`undefined` on a probed index, which is 'nobody
 * looked' rather than 'no gap'" (fixed in 0.6.83).
 *
 * The example is the page's whole argument for EDF+D support, and `discontinuous.md` opens by
 * demonstrating the same call failing before it reaches for `buildRecordIndex`. The landing page
 * showed the destination without the step.
 *
 * `chunks[1]` is also an unguarded index read, which is the class 0.6.78 fixed one sample above
 * it; it is optional-chained now so the line compiles under the flags this repo builds with.
 *
 * The sequence is executed below on a file with a real hole, so this fails if either half stops
 * being true.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const PAGE = readFileSync(new URL('../../website/src/pages/index.astro', import.meta.url), 'utf8');

/** Eight one-second records with a five-second hole after the fourth. */
const WITH_A_GAP = buildEdf({
  plus: 'D',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
  recordOnsetSeconds: (record) => (record < 4 ? record : record + 5),
});

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 7200 } as const;

describe('the sequence the example now shows', () => {
  it('returns one chunk per contiguous run', async () => {
    const recording = await openEdf(byteSource(WITH_A_GAP));
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow({ ...recording, index }, WINDOW);
    expect(chunks).toHaveLength(2);
  });

  it('puts a gap on the second chunk, which is what the last line reads', async () => {
    const recording = await openEdf(byteSource(WITH_A_GAP));
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow({ ...recording, index }, WINDOW);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(5);
  });
});

describe('the sequence it used to show', () => {
  it('throws on the index openEdf returns', async () => {
    const recording = await openEdf(byteSource(WITH_A_GAP));
    const thrown = await readWindow(recording, WINDOW).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('gap');
  });
});

describe('the example on the page', () => {
  it('builds the index before it reads', () => {
    expect(PAGE).toContain('const index = await buildRecordIndex(recording);');
    expect(PAGE).toContain('await readWindow({ ...recording, index }, {');
  });

  it('does not read a chunk it has not checked for', () => {
    expect(PAGE).toContain('chunks[1]?.precededByGap;');
    expect(PAGE).not.toContain('chunks[1].precededByGap;');
  });
});
