/**
 * How far `strict` reaches, and where it stops.
 *
 * `strict` is "the one option that changes what a parse does rather than what it costs", and
 * `api-reading.md` says of a read that "decoding those annotations is never strict, so a malformed
 * TAL in another channel still returns samples". `recording.ts` says the same at the call site, and
 * adds the part that matters: "not because the flag was lost".
 *
 * It is not lost, and that is structural rather than careful — `ReadOptions` has no `strict`
 * member at all, so a read cannot be asked to be strict even by a caller who wants it. That is the
 * first thing checked here, because it is the reason the rest holds and the only part a refactor
 * could quietly undo.
 *
 * What follows is the map nobody had drawn, and it has three cells rather than two. `openEdf`
 * probes exactly two records for their timekeeping onsets, so `strict` reaches those two and
 * nothing else:
 *
 *   bad TAL in record 0        openEdf(strict) throws   readRecords returns every sample
 *   bad TAL in a middle record openEdf(strict) OPENS    readRecords returns every sample
 *   bad TAL in the last record openEdf(strict) throws   readRecords returns every sample
 *
 * The middle row is the surprising one and it is not a defect: a probed index has read two records,
 * so `strict` can only reject what it has seen, and rejecting a file for a defect nobody looked for
 * would be a claim the probe cannot make. A caller who wants the middle row to fail runs
 * `validateRecording`, which reads every record. Stated here because "strict rejects a file with
 * any defect" is what a reader assumes, and it is wrong in a way no error message will correct.
 *
 * In every cell the samples come back and the defect lands on `chunk.diagnostics`, next to the data
 * it was found beside. That is the half the read path exists to protect: a malformed TAL in the
 * annotations channel is not a reason to return no samples from the EEG.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EdfFormatError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORD_COUNT = 6;
const LAST = RECORD_COUNT - 1;
const MIDDLE = 3;

/** A conforming EDF+C file except for one record's event TAL, whose onset is not a number. */
function badTalIn(recordIndex: number): Uint8Array {
  return buildEdf({
    format: 'EDF',
    plus: 'C',
    recordCount: RECORD_COUNT,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4, sample: (r, k) => r * 10 + k }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: (r) =>
          r === recordIndex
            ? [{ onset: '+2.x', texts: ['bad'] }]
            : [{ onset: r + 0.5, texts: ['ok'] }],
      },
    ],
  });
}

async function readAll(bytes: Uint8Array): Promise<EdfChunk> {
  const recording = await openEdf(byteSource(bytes));
  return readRecords(recording, {
    records: { start: 0, count: RECORD_COUNT },
    signalIndices: [0],
  });
}

describe('a read cannot be asked to be strict', () => {
  it('is structural: ReadOptions declares no strict member', () => {
    // The reason `readRecords` is never strict is that there is nowhere to put the flag. Checked
    // against the source rather than by calling, because a member added later would compile, be
    // ignored, and leave the sentence on `api-reading.md` describing an option that exists.
    const types = readFileSync(new URL('../../src/types.ts', import.meta.url), 'utf8');
    const start = types.indexOf('export interface ReadOptions {');
    expect(start, 'ReadOptions is gone from types.ts').toBeGreaterThan(-1);
    const body = types.slice(start, types.indexOf('}', start));
    expect(body).not.toContain('strict');
    // And `ParseOptions`, which openEdf takes, does declare it — or the check above is vacuous
    // because nothing anywhere declares `strict`.
    const parseStart = types.indexOf('export interface ParseOptions {');
    expect(types.slice(parseStart, types.indexOf('}', parseStart))).toContain('strict');
  });
});

describe('strict reaches the two records openEdf probes', () => {
  for (const [where, name] of [
    [0, 'record 0'],
    [LAST, 'the last record'],
  ] as const) {
    it(`throws at open for a malformed TAL in ${name}`, async () => {
      let thrown: unknown;
      try {
        await openEdf(byteSource(badTalIn(where)), { strict: true });
        expect.unreachable('strict opened a file whose probed record is malformed');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(EdfFormatError);
      expect((thrown as EdfFormatError).code).toBe('TAL_MALFORMED');
      expect((thrown as Error).message).toContain(`record ${where}`);
    });
  }

  it('opens the same file when the defect is in a record it did not probe', async () => {
    // Not a defect. A probed index has read two records, so strict can only reject what it saw;
    // rejecting for a defect nobody looked for would be a claim the probe cannot make.
    const recording = await openEdf(byteSource(badTalIn(MIDDLE)), { strict: true });
    expect(recording.header.recordCount).toBe(RECORD_COUNT);
    expect(recording.index.coverage).toBe('probed');
  });

  it('is the same file in all three cases, so the difference is where the defect sits', async () => {
    const lengths = [0, MIDDLE, LAST].map((where) => badTalIn(where).byteLength);
    expect(new Set(lengths).size).toBe(1);
  });
});

describe('a read returns the samples wherever the defect sits', () => {
  for (const where of [0, MIDDLE, LAST]) {
    it(`decodes every sample with a malformed TAL in record ${where}`, async () => {
      const chunk = await readAll(badTalIn(where));
      // Six records of four samples, unchanged by a defect in a different channel.
      expect(Array.from(chunk.signals[0]?.digital ?? [])).toEqual([
        0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33, 40, 41, 42, 43, 50, 51, 52, 53,
      ]);
      // And the defect is reported beside the data rather than swallowed.
      expect(chunk.diagnostics.map((diagnostic) => diagnostic.code)).toContain('TAL_MALFORMED');
      expect(
        chunk.diagnostics.find((diagnostic) => diagnostic.code === 'TAL_MALFORMED')?.recordIndex,
      ).toBe(where);
    });
  }

  it('reports nothing at all when no TAL is malformed, so the code above is not always present', async () => {
    const clean = buildEdf({
      format: 'EDF',
      plus: 'C',
      recordCount: RECORD_COUNT,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4, sample: (r, k) => r * 10 + k }],
      annotationSignals: [
        { samplesPerRecord: 40, tals: (r) => [{ onset: r + 0.5, texts: ['ok'] }] },
      ],
    });
    const chunk = await readAll(clean);
    expect(chunk.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('TAL_MALFORMED');
  });
});
