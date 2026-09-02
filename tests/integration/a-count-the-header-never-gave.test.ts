/**
 * The twelfth shape in the matrix: a record count recovered from the source length.
 *
 * `types.ts` says of the field, "Verbatim. `-1` means the writer never closed the file", and it is
 * not a rare accident — it is what a recorder writes while it is still recording, and what stays
 * there if the software crashes or the disk fills. `parseHeader` recovers the count from the
 * source's length, reports `RECORD_COUNT_RECOVERED`, and sets `recordCountSource`.
 *
 * `parse.test.ts` checks the recovery and `one-recording-two-spellings.test.ts` checks that the
 * recovered file is the same recording as one that declares its count. What neither could do is put
 * the shape in front of the twenty-two sweeps that run over `AWKWARD` — every-index-resolves,
 * ticks-and-seconds-agree, every-array-is-frozen, nothing-points-at-your-buffer, the five source
 * spellings, and the rest. Each of those asks a question of a whole file, and this is the only
 * shape in the matrix whose geometry rests on arithmetic rather than on a number the file states.
 *
 * They all pass over it. That is the point of adding it: the properties were stated to hold for
 * any file, and until now none of them had seen one whose record count nobody wrote down.
 *
 * This file pins what makes it that shape, so it cannot quietly stop being one — a fixture that
 * drifts into an ordinary file would leave twenty-two sweeps looking as though they cover something
 * they no longer do.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

const SHAPE = AWKWARD.find((file) => file.name === 'a record count the header never gave');

/** The same recording with the count written out, which is the only thing that differs. */
const DECLARED = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 5,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 20 }],
});

describe('the shape', () => {
  it('is in the matrix, which is twelve shapes', () => {
    expect(SHAPE).toBeDefined();
    expect(AWKWARD).toHaveLength(14);
  });

  it('says -1 in the field and five in the header', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the recovered-count shape');
    const recording = await openEdf(byteSource(SHAPE.bytes));

    expect(recording.header.raw.recordCount.trim()).toBe('-1');
    expect(recording.header.recordCount).toBe(5);
    expect(recording.header.recordCountSource).toBe('sourceByteLength');
  });

  it('says so, rather than recovering silently', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the recovered-count shape');
    const recording = await openEdf(byteSource(SHAPE.bytes));
    const codes = recording.header.diagnostics.map((one) => one.code);
    expect(codes).toContain('RECORD_COUNT_RECOVERED');
  });

  it('is one of the two shapes that recover a count, and the raw field says which', async () => {
    // Two causes, one mechanism. This shape declares `-1` — a writer that never closed the file —
    // and 'a download that stopped part way' declares a real count the bytes do not reach. Both
    // resolve through the source length, and `header.raw.recordCount` is what tells them apart,
    // which is why that field is kept.
    const recovered: Array<{ name: string; declared: string }> = [];
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      if (recording.header.recordCountSource !== 'sourceByteLength') continue;
      recovered.push({ name: file.name, declared: recording.header.raw.recordCount.trim() });
    }
    expect(recovered).toEqual([
      { name: 'a download that stopped part way', declared: '6' },
      { name: 'a record count the header never gave', declared: '-1' },
    ]);
  });
});

describe('and it is the same recording as the one that declares its count', () => {
  it('reads the same header, apart from the field and the diagnostic that names it', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the recovered-count shape');
    const recovered = await openEdf(byteSource(SHAPE.bytes));
    const declared = await openEdf(byteSource(DECLARED));

    expect(recovered.header.recordCount).toBe(declared.header.recordCount);
    expect(recovered.header.recordByteLength).toBe(declared.header.recordByteLength);
    expect(recovered.timeline).toEqual(declared.timeline);

    const extra = recovered.header.diagnostics
      .map((one) => one.code)
      .filter((code) => !declared.header.diagnostics.map((two) => two.code).includes(code));
    expect(extra).toEqual(['RECORD_COUNT_RECOVERED']);
  });

  it('reads the same samples', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the recovered-count shape');
    const selection = { records: { start: 0, count: 5 }, signalIndices: [0] } as const;
    const recovered = await readRecords(await openEdf(byteSource(SHAPE.bytes)), selection);
    const declared = await readRecords(await openEdf(byteSource(DECLARED)), selection);
    expect(recovered.signals[0]?.digital).toEqual(declared.signals[0]?.digital);
  });
});
