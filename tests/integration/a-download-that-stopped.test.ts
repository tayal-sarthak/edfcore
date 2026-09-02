/**
 * The fourteenth shape: a file whose last record is half there.
 *
 * It is the commonest damage a recording takes. A transfer drops, a disk fills, a copy is
 * interrupted, a recorder loses power mid-record — and what lands is a valid header promising more
 * records than the bytes hold, ending part way through one. edfcore has diagnosed it since 0.1:
 * `TRUNCATED_FILE` for the shortfall and `PARTIAL_FINAL_RECORD` for the tail, with the rule that
 * only whole records are exposed "because the padding would decode as real samples".
 *
 * The diagnostics were covered. The shape was not put in front of the sweeps that run over
 * `AWKWARD` — every index resolves, ticks and seconds agree, nothing points at the caller's
 * buffer, the five source spellings, the second call agrees, every column lines up — each of which
 * asks a question of a whole file, and none of which had seen a file whose bytes end before its
 * header says they do.
 *
 * They all pass over it.
 *
 * It also makes a pair with 'a record count the header never gave'. Both resolve their count from
 * the source length, for different reasons: that one declares `-1`, a writer that never closed the
 * file, and this one declares a real count the bytes do not reach. `header.raw.recordCount` is what
 * tells them apart, which is why that field is kept beside the resolved one.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';

const SHAPE = AWKWARD.find((file) => file.name === 'a download that stopped part way');

async function shape() {
  if (SHAPE === undefined) throw new Error('the matrix lost the truncated shape');
  return openEdf(byteSource(SHAPE.bytes));
}

describe('the shape', () => {
  it('is in the matrix, which is fourteen shapes', () => {
    expect(SHAPE).toBeDefined();
    expect(AWKWARD).toHaveLength(15);
  });

  it('promises six records and holds five', async () => {
    const { header } = await shape();
    expect(header.raw.recordCount.trim()).toBe('6');
    expect(header.recordCount).toBe(5);
    expect(header.recordCountSource).toBe('sourceByteLength');
  });

  it('says both of the things that are wrong with it', async () => {
    const codes = (await shape()).header.diagnostics.map((one) => one.code);
    expect(codes).toContain('TRUNCATED_FILE');
    expect(codes).toContain('PARTIAL_FINAL_RECORD');
  });

  it('really ends part way through a record, not on a boundary', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the truncated shape');
    const { header } = await shape();
    const data = SHAPE.bytes.length - header.headerByteLength;
    expect(data % header.recordByteLength).not.toBe(0);
    // And the two diagnostics are not the same claim: a file ending exactly on a boundary is
    // truncated without a partial record.
    expect(data).toBeLessThan(6 * header.recordByteLength);
  });
});

describe('what it refuses to invent', () => {
  it('will not read the record the header promised', async () => {
    const recording = await shape();
    await expect(
      readRecords(recording, { records: { start: 0, count: 6 }, signalIndices: [0] }),
    ).rejects.toThrow();
  });

  it('reads every whole record it does have', async () => {
    const recording = await shape();
    const read = await readRecords(recording, {
      records: { start: 0, count: 5 },
      signalIndices: [0],
    });
    const signal = recording.header.signals[0];
    expect(read.signals[0]?.digital).toHaveLength(5 * (signal?.samplesPerRecord ?? 0));
  });

  it('scans what is there, and says how much that was', async () => {
    const report = await validateRecording(await shape(), { scanSamples: true });
    expect(report.recordsScanned).toBe(5);
    expect(report.diagnostics.map((one) => one.code)).toContain('TRUNCATED_FILE');
  });
});
