/**
 * `maxMaterializeBytes` is a memory budget, and a memory budget must not change an answer.
 *
 * `validateRecording` and `readEnvelope` both fold a recording one SCAN CHUNK at a time and call
 * `decodeAnnotations` once per chunk. `tal/annotations.ts` caps `NEGATIVE_ANNOTATION_ONSET` at one
 * report per CALL — the onsets are all in the result, so a second report carries nothing — and the
 * cap therefore reset at every chunk boundary. The count became "how many chunks happened to
 * contain one", and the chunk size is `scanChunkRecords(header, maxMaterializeBytes)`.
 *
 * On an eight-record file where every record carries a negative onset, `validateRecording` reported
 * it 3, 4, 5 or 10 times for the same file depending only on the budget (fixed in 0.3.60).
 *
 * This is the fourth time this shape has been swept out of the package, so the test is written as
 * the general property rather than as the one code: whatever these two calls report, they must
 * report the same thing at every budget.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** Every record carries a negative onset, which is capped at one report per decode call. */
const EVERY_RECORD_NEGATIVE = buildEdf({
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'A', samplesPerRecord: 4 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (recordIndex: number) => [
        { onset: `-${recordIndex + 1}.5`, texts: [`pre${recordIndex}`] },
      ],
    },
  ],
});

/** Budgets small enough to force many scan chunks, and large enough to force one. */
const BUDGETS = [200, 400, 1000, 100_000];

/** A stable, order-insensitive summary of what a diagnostic list reports. */
function census(codes: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts]
    .map(([code, count]) => `${code}x${count}`)
    .sort()
    .join(' ');
}

describe('maxMaterializeBytes does not change what is reported', () => {
  it('the fixture really does span several scan chunks at the small budgets', async () => {
    // Without this the test could pass by every budget producing one chunk, which proves nothing.
    const recording = await openEdf(byteSource(EVERY_RECORD_NEGATIVE));
    const small = await validateRecording(recording, { maxMaterializeBytes: 200 });
    expect(small.recordsScanned).toBe(8);
    expect(small.bytesRead).toBeGreaterThan(200);
  });

  it('validateRecording reports the same diagnostics at every budget', async () => {
    const seen = new Set<string>();
    for (const maxMaterializeBytes of BUDGETS) {
      const recording = await openEdf(byteSource(EVERY_RECORD_NEGATIVE));
      const report = await validateRecording(recording, { maxMaterializeBytes });
      seen.add(census(report.diagnostics.map((d) => d.code)));
    }
    expect([...seen]).toHaveLength(1);
  });

  it('readEnvelope reports the same chunk diagnostics at every budget', async () => {
    const seen = new Set<string>();
    for (const maxMaterializeBytes of BUDGETS) {
      const opened = await openEdf(byteSource(EVERY_RECORD_NEGATIVE));
      const recording = { ...opened, index: await buildRecordIndex(opened) };
      const chunks = await readEnvelope(
        recording,
        { startSeconds: 0, durationSeconds: 8, buckets: 4, signalIndices: [0] },
        { maxMaterializeBytes },
      );
      seen.add(census(chunks.flatMap((c) => c.diagnostics).map((d) => d.code)));
    }
    expect([...seen]).toHaveLength(1);
  });
});
