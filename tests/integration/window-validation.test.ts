/**
 * A bad `signalIndices` is reported as a bad `signalIndices`, wherever the window lands.
 *
 * `readWindow` validated the selection inside `readChunk`, which only runs once the window has
 * resolved to at least one record. So the same mistake produced two different outcomes: a throw
 * for a window over data, and `[]` for a window past the end or inside a gap.
 *
 * `[]` is documented to mean "no records in this window". Letting an out-of-range index produce
 * it hands the caller the wrong diagnosis at the one moment they cannot cross-check it — a typo
 * reads as an empty stretch of recording.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const RECORDS = 4;
const RECORD_SECONDS = 1;

async function recording(): Promise<EdfRecording> {
  return openEdf(
    byteSource(minimalEdfPlus({ recordCount: RECORDS, recordDurationSeconds: RECORD_SECONDS })),
  );
}

/** A window over real data, and one past the end where the old code returned []. */
const WINDOWS = [
  { name: 'a window over data', startSeconds: 0, durationSeconds: 1 },
  { name: 'a window past the end', startSeconds: 9999, durationSeconds: 1 },
] as const;

describe('readWindow validates signalIndices regardless of what the window selects', () => {
  for (const window of WINDOWS) {
    it(`rejects an out-of-range index for ${window.name}`, async () => {
      const edf = await recording();
      await expect(
        readWindow(edf, {
          signalIndices: [99],
          startSeconds: window.startSeconds,
          durationSeconds: window.durationSeconds,
        }),
      ).rejects.toMatchObject({ edfErrorKind: 'channel' });
    });

    it(`rejects the annotations channel for ${window.name}`, async () => {
      const edf = await recording();
      // Its bytes are TAL text, so decoding them as samples produces numbers that look like a
      // signal. That is worth refusing whether or not the window happens to cover any records.
      await expect(
        readWindow(edf, {
          signalIndices: edf.header.annotationSignalIndices,
          startSeconds: window.startSeconds,
          durationSeconds: window.durationSeconds,
        }),
      ).rejects.toThrow(RangeError);
    });
  }

  it('still returns [] for a valid selection that genuinely selects nothing', async () => {
    // The fix must not turn "nothing here" into an error — that distinction is the whole point.
    const edf = await recording();
    const chunks = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 9999,
      durationSeconds: 1,
    });
    expect(chunks).toEqual([]);
  });

  it('still reads a valid selection over data', async () => {
    const edf = await recording();
    const chunks = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: RECORDS * RECORD_SECONDS,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.signals[0]?.digital.length).toBeGreaterThan(0);
  });
});
