/**
 * edfcore reads. It does not write — your bytes included.
 *
 * `reads-not-writes.test.ts` checks the five places the package SAYS so: the README, AGENTS.md,
 * `comparison.md`, `design-decisions.md` and the npm keywords. All five are about the missing
 * feature — edfcore does not produce EDF files. None of them is about the bytes you already have,
 * and that is the one a caller is exposed to without ever reading a page.
 *
 * The exposure is structural rather than hypothetical. `byteSource` is zero-copy by design, so
 * every read inside the library is a `subarray` into the caller's own buffer, and every decode
 * loop runs over one. `decodeInt16` walking that view with a `set` instead of a read would
 * corrupt the caller's copy of their own recording in place, and nothing downstream would look
 * wrong: the samples returned would still be the samples that were there.
 *
 * So the rule is executed. The caller's buffer is captured byte for byte, the whole reading API
 * runs over it — open, index, validate with a full sample sweep, inspect, annotations, records,
 * windows, envelopes, scaling and a stream — and the buffer must be identical afterwards, over all
 * eleven `AWKWARD` shapes and a gapped file.
 *
 * `fileSource` gets the same question asked of the filesystem, where the answer would be worse:
 * the bytes on disk and the file's modification time both have to survive a full read.
 *
 * The one documented exception is asserted as an exception, so the rule reads as a rule: `out` on
 * `toPhysical` is a buffer the caller supplied to be written into, and it is.
 */

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { readEnvelope } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { fileSource } from '../../src/node.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { ByteSource } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', duration: 2, texts: ['seizure'] }] : []),
    },
  ],
});

/** Everything that reads, run once over one source. The return values are not the point here. */
async function readEverything(
  bytes: Uint8Array,
  wrap: (source: ByteSource) => ByteSource,
): Promise<number> {
  let touched = 0;
  const recording = await openEdf(wrap(byteSource(bytes)));
  const index = await buildRecordIndex(recording);
  const located = { ...recording, index };
  const signalIndices = [...recording.header.dataSignalIndices];
  touched += 1;

  await validateRecording(recording, { scanSamples: true });
  await inspectEdf(wrap(byteSource(bytes)));
  await readAnnotations(recording, { start: 0, count: recording.header.recordCount });
  touched += 3;

  const readable =
    signalIndices.length > 0 &&
    recording.header.recordCount > 0 &&
    recording.header.recordDurationSeconds > 0;
  if (!readable) return touched;

  const chunk = await readRecords(located, { records: { start: 0, count: 1 }, signalIndices });
  await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices });
  await readEnvelope(located, { startSeconds: 0, durationSeconds: 3, buckets: 4, signalIndices });
  for await (const _piece of streamRecords(located, {
    startSeconds: 0,
    durationSeconds: 20,
    signalIndices,
  })) {
    touched += 1;
  }
  for (const signal of chunk.signals) {
    const header = recording.header.signals[signal.signalIndex];
    if (header?.scale !== undefined) toPhysical(header, signal.digital);
  }
  return touched + 3;
}

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a file with a gap', GAPPED],
];

/**
 * Both ways a source can be wired, because only one of them hands the decoder the caller's memory.
 *
 * `cachedSource` copies each chunk into a buffer of its own, so every decode downstream of one
 * runs over the cache's bytes and a write there could never reach the caller. The bare
 * `byteSource` is the case that matters: its reads are `subarray` views, so `decodeInt16` walks
 * the caller's own array. A sweep that only ran the cached path would pass with an in-place write
 * in the decoder — checked, by putting one there.
 */
const WIRINGS: ReadonlyArray<readonly [string, (source: ByteSource) => ByteSource]> = [
  ['unwrapped, where a read is a view into the caller buffer', (source) => source],
  ['behind cachedSource, which reads through its own copy', (source) => cachedSource(source)],
];

describe('reading a file leaves the caller buffer byte for byte as it was', () => {
  for (const [name, source] of FILES) {
    for (const [wiring, wrap] of WIRINGS) {
      it(`does not write into ${name}, ${wiring}`, async () => {
        const bytes = source.slice();
        const before = source.slice();
        const touched = await readEverything(bytes, wrap);
        // A file nothing can be read from still reaches four entry points; the rest reach more.
        expect(touched).toBeGreaterThanOrEqual(4);
        expect(bytes).toEqual(before);
      });
    }
  }
});

describe('and the file on disk, where a write would be worse', () => {
  it('leaves both the bytes and the modification time alone', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'edfcore-reads-'));
    const path = join(directory, 'night.edf');
    writeFileSync(path, GAPPED);
    const before = readFileSync(path);
    const stamp = statSync(path).mtimeMs;

    const source = await fileSource(path);
    const recording = await openEdf(source);
    const index = await buildRecordIndex(recording);
    await readWindow(
      { ...recording, index },
      {
        startSeconds: 0,
        durationSeconds: 20,
        signalIndices: [...recording.header.dataSignalIndices],
      },
    );
    await source.close?.();

    expect(readFileSync(path)).toEqual(before);
    expect(statSync(path).mtimeMs).toBe(stamp);
  });
});

describe('the one buffer edfcore does write into is the one you asked it to', () => {
  it('fills the `out` array toPhysical was handed, so the rule above is a rule and not a tautology', async () => {
    const recording = await openEdf(byteSource(GAPPED.slice()));
    const index = await buildRecordIndex(recording);
    const signalIndices = [...recording.header.dataSignalIndices];
    const chunk = await readRecords(
      { ...recording, index },
      { records: { start: 0, count: 2 }, signalIndices },
    );
    const signal = chunk.signals[0];
    expect(signal).toBeDefined();
    const header = recording.header.signals[signal?.signalIndex ?? 0];
    expect(header?.scale).toBeDefined();

    const out = new Float64Array(signal?.sampleCount ?? 0).fill(Number.NaN);
    if (header === undefined || signal === undefined) throw new Error('fixture lost its signal');
    const returned = toPhysical(header, signal.digital, out);
    expect(returned).toBe(out);
    expect([...out].every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the twelve shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(12);
  });
});
