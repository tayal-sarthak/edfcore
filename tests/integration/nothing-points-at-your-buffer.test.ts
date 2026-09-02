/**
 * Nothing edfcore hands back points into the bytes you handed it.
 *
 * `byteSource` is documented as zero-copy: "each one returns a `subarray` view over your own
 * buffer", and `io/bytes.ts` explains why that is safe — the adapter retains nothing the caller
 * does not already hold. That is a statement about the ADAPTER. It says nothing about the values
 * the reading API builds out of those views, and those are the ones a caller keeps.
 *
 * Two sites state the rule for themselves, in different words, and neither is checked.
 * `header/parse.ts` copies the header bytes — "A copy, not a view: the caller owns the buffer it
 * read into and is free to reuse it, and a header that quietly changed under a hexdump would be
 * worse than no hexdump." `diagnostics/collector.ts` copies a diagnostic's evidence — "Copied, not
 * aliased: a diagnostic outlives the read that produced it, and the caller's view is typically a
 * subarray of a buffer an I/O adapter is free to reuse."
 *
 * The second is the one holding the property up. The header is copied twice over — `readHeader`
 * joins its two reads into a buffer of its own before `parseHeader` sees them — so replacing that
 * `copyBytes` with a `subarray` changes nothing observable. The four `rawBytes` in `tal/` are
 * `sliceBytes` calls, which is a `subarray` of the RECORD bytes, and `readRecordBytes` returns
 * those straight from the source with no copy anywhere. Take the `.slice()` out of the collector
 * and a `TAL_MALFORMED` diagnostic hands the caller a window into their own file.
 *
 * So it is checked as a rule. Every value every entry point returns is walked over all eleven
 * `AWKWARD` shapes and a gapped file, and every typed array found anywhere in the graph must be
 * backed by a buffer that is not the caller's. Then the caller's buffer is overwritten end to end
 * and every answer is compared against a clone taken before — which is the failure a caller would
 * actually see: a header that reads differently after they reused the array they fetched into.
 *
 * The first assertion is that a `byteSource` read DOES alias, so the risk being checked for is
 * real rather than impossible.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
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

interface Answer {
  readonly what: string;
  readonly value: unknown;
}

/** Everything the public API returns for one file, minus the two values that hold functions. */
async function answersFor(bytes: Uint8Array, name: string): Promise<readonly Answer[]> {
  const answers: Answer[] = [];
  const recording = await openEdf(byteSource(bytes));
  const index = await buildRecordIndex(recording);
  const located = { ...recording, index };
  const signalIndices = [...recording.header.dataSignalIndices];

  answers.push({ what: `${name}: header`, value: recording.header });
  answers.push({ what: `${name}: timeline`, value: recording.timeline });
  answers.push({ what: `${name}: index.segments`, value: index.segments });
  answers.push({ what: `${name}: index.gaps`, value: index.gaps });
  answers.push({ what: `${name}: inspectEdf`, value: await inspectEdf(byteSource(bytes)) });
  answers.push({
    what: `${name}: validateRecording`,
    value: await validateRecording(recording, { scanSamples: true }),
  });
  answers.push({
    what: `${name}: readAnnotations`,
    value: await readAnnotations(recording, { start: 0, count: recording.header.recordCount }),
  });

  const readable =
    signalIndices.length > 0 &&
    recording.header.recordCount > 0 &&
    recording.header.recordDurationSeconds > 0;
  if (!readable) return answers;

  answers.push({
    what: `${name}: readRecords`,
    value: await readRecords(located, { records: { start: 0, count: 1 }, signalIndices }),
  });
  answers.push({
    what: `${name}: readWindow`,
    value: await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices }),
  });
  answers.push({
    what: `${name}: readEnvelope`,
    value: await readEnvelope(located, {
      startSeconds: 0,
      durationSeconds: 3,
      buckets: 4,
      signalIndices,
    }),
  });
  return answers;
}

/** Every typed array in the graph, with the path that reached it. */
function views(
  value: unknown,
  path: string,
  found: Array<{ path: string; view: ArrayBufferView }>,
  depth = 0,
): void {
  if (depth > 9 || value === null || typeof value !== 'object') return;
  if (ArrayBuffer.isView(value)) {
    found.push({ path, view: value });
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) views(item, `${path}[${index}]`, found, depth + 1);
    return;
  }
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    views(member, `${path}.${key}`, found, depth + 1);
  }
}

/**
 * A file whose annotation onsets are not numbers, so every record yields a `TAL_MALFORMED`
 * diagnostic quoting the bytes it could not read.
 *
 * Every other shape here produces `rawBytes` only for the header, and the header is copied out of
 * the read before `parseHeader` ever sees it. The evidence a TAL diagnostic carries is sliced
 * straight out of the RECORD bytes, which `readRecordBytes` returns unsliced from the source — so
 * this is the one path where a missing copy would put the caller's buffer on a returned object.
 */
const MALFORMED = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: () => [{ onset: 'abc', texts: ['mark'] }],
    },
  ],
});

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a file with a gap', GAPPED],
  ['a file whose TALs are malformed', MALFORMED],
];

const ALL_PATHS: string[] = [];

describe('a byteSource read really is a view over your buffer', () => {
  it('hands back a subarray of the caller buffer, which is what makes this worth checking', async () => {
    const bytes = GAPPED.slice();
    const read = await byteSource(bytes).read(0, 256);
    expect(read.buffer).toBe(bytes.buffer);
    expect(read.byteLength).toBe(256);
  });
});

describe('but nothing the reading API returns does', () => {
  for (const [name, source] of FILES) {
    it(`keeps every typed array off the caller buffer for ${name}`, async () => {
      // A copy per case, so the buffer identity being compared belongs to this test alone.
      const bytes = source.slice();
      const found: Array<{ path: string; view: ArrayBufferView }> = [];
      for (const answer of await answersFor(bytes, name)) views(answer.value, answer.what, found);

      expect(found.length).toBeGreaterThan(0);
      const aliased = found.filter((entry) => entry.view.buffer === bytes.buffer);
      expect(aliased.map((entry) => entry.path)).toEqual([]);
      ALL_PATHS.push(...found.map((entry) => entry.path));
    });
  }
});

describe('so overwriting your buffer afterwards changes no answer you already have', () => {
  for (const [name, source] of FILES) {
    it(`survives the caller scribbling over ${name}`, async () => {
      const bytes = source.slice();
      const answers = await answersFor(bytes, name);
      const before = answers.map((answer) => structuredClone(answer.value));

      // What a caller does when they reuse the array they fetched into.
      bytes.fill(0xa5);

      for (const [index, answer] of answers.entries()) {
        expect(answer.value, `${answer.what} changed`).toEqual(before[index]);
      }
    });
  }
});

describe('and the sweep reached the path where a missing copy would show', () => {
  it('walked a diagnostic that quotes bytes out of a record, not only header bytes', () => {
    // `header.rawBytes` is copied in `header/parse.ts` and the read layer has copied it once
    // already, so a sweep that found only those would pass whatever the evidence path does.
    const evidence = ALL_PATHS.filter(
      (path) => path.includes('diagnostics') && path.endsWith('.rawBytes'),
    );
    expect(evidence.length).toBeGreaterThan(0);
    expect(ALL_PATHS.some((path) => path.endsWith('.digital'))).toBe(true);
    expect(ALL_PATHS.some((path) => path.endsWith('.recordOnsetTicks'))).toBe(true);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the sixteen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(16);
  });
});
