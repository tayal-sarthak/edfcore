/**
 * A read that blamed the source for a header from another file.
 *
 * `readRecordBytes(source, header, records)` takes the two as separate arguments, and nothing but
 * the caller pairs them. `openEdf` establishes the relation at open time — a source too small for
 * the header it parsed lowers `recordCount` and sets `recordCountSource` to `'sourceByteLength'` —
 * and nothing re-checked it afterwards.
 *
 * `readWindow`'s docblock teaches rebuilding a recording by spread:
 *
 *     const index = await buildRecordIndex(rec);
 *     await readWindow({ ...rec, index }, selection)
 *
 * so a recording whose four fields do not all come from one file is a shape the package asks for.
 * `resolveTimeWindow` catches the index against the timeline — 0.6.299 is about the gap that left
 * in `sampleAt` — and this is the other pair.
 *
 * What it did was blame the argument that was right. The first read asked for a range the HEADER
 * describes, the source was shorter, and `assertReadRange` answered
 *
 *     ByteSource.read(offset 768, length 720) ends at byte 1488, past the end of a 1088-byte
 *     source. Next: clamp the request, or check that the source was built over the whole file
 *     rather than a prefix of it.
 *
 * — advice to clamp a range that is inside the file it was computed for, about a source that is the
 * whole of a different one.
 *
 * A LOWER bound only, and that is the whole of what this can check. Trailing bytes are legal and
 * diagnosed rather than refused — `TRAILING_BYTES` and `PARTIAL_FINAL_RECORD` — so a source longer
 * than its header implies is a real file and has to keep reading. The reverse mix, a header
 * describing less than its source holds, is indistinguishable from one of those files; the last test
 * here pins that it still reads, so the limit is on the record rather than implied (0.6.300).
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const file = (recordCount: number): Uint8Array =>
  minimalEdfPlus({
    recordCount,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
  } as never);

const settle = async (drive: () => unknown): Promise<string> =>
  Promise.resolve()
    .then(drive)
    .then(
      () => '',
      (error: unknown) => (error as Error).message,
    );

async function pair(): Promise<{ small: EdfRecording; large: EdfRecording }> {
  return { small: await openEdf(byteSource(file(4))), large: await openEdf(byteSource(file(9))) };
}

describe('a source the header was not parsed from', () => {
  it('is a real size disagreement, not a truncated file', async () => {
    const { small, large } = await pair();
    expect(small.source.byteLength).toBe(1088);
    expect(large.source.byteLength).toBe(1488);
    // Both opened cleanly from their own bytes, so neither header is the product of a short source.
    expect(small.header.recordCountSource).toBe('headerField');
    expect(large.header.recordCountSource).toBe('headerField');
  });

  it('is named as the pair it is, rather than blamed on the source', async () => {
    const { small, large } = await pair();
    const message = await settle(() =>
      readRecordBytes(small.source, large.header, { start: 0, count: 9 }),
    );
    expect(message).toContain('this header describes a 1488-byte file');
    expect(message).toContain('but the source holds 1088');
    expect(message).toMatch(/Next: pass the source this header was parsed from/);
    // The old sentence, which told them to clamp a range that was never out of range.
    expect(message).not.toMatch(/clamp the request/);
  });

  it('says why a shorter source is not simply a shorter file', async () => {
    const { small, large } = await pair();
    const message = await settle(() =>
      readRecordBytes(small.source, large.header, { start: 0, count: 1 }),
    );
    expect(message).toMatch(/openEdf\(\) lowers recordCount for one and records that it did/);
  });

  it('reaches every read, since they all funnel through here', async () => {
    const { small, large } = await pair();
    const mixed = { ...large, source: small.source } as EdfRecording;
    for (const [name, drive] of [
      [
        'readWindow',
        () => readWindow(mixed, { signalIndices: [0], startSeconds: 0, durationSeconds: 9 }),
      ],
      [
        'readRecords',
        () => readRecords(mixed, { signalIndices: [0], records: { start: 0, count: 9 } }),
      ],
    ] as const) {
      expect(await settle(drive), name).toContain('this header describes a 1488-byte file');
    }
  });

  it('is a file-or-range error, which is what a size disagreement is', async () => {
    const { small, large } = await pair();
    const thrown = await Promise.resolve()
      .then(() => readRecordBytes(small.source, large.header, { start: 0, count: 9 }))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(isEdfError(thrown)).toBe(true);
  });

  it('still reads a matched pair, and a zero-count range, unchanged', async () => {
    const { small, large } = await pair();
    expect(
      (await readRecordBytes(small.source, small.header, { start: 0, count: 4 })).byteLength,
    ).toBe(320);
    expect(
      (await readRecordBytes(large.source, large.header, { start: 0, count: 9 })).byteLength,
    ).toBe(720);
    expect(
      (await readRecordBytes(small.source, small.header, { start: 0, count: 0 })).byteLength,
    ).toBe(0);
  });

  it('still reads a source LONGER than its header implies, which is a legal file', async () => {
    // Trailing bytes are diagnosed, not refused, so the bound here can only be a lower one — and
    // that is why the opposite mix is not caught.
    const raw = file(4);
    const padded = new Uint8Array(raw.byteLength + 500);
    padded.set(raw, 0);
    const recording = await openEdf(byteSource(padded));
    expect(recording.header.diagnostics.map((d) => d.code)).toContain('TRAILING_BYTES');
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
    });
    expect(chunks[0]?.signals[0]?.sampleCount).toBe(40);
  });
});
