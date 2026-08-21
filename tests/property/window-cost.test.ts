/**
 * What a window costs, over arbitrary files rather than the ones the documentation draws.
 *
 * Four checks in this batch pinned a read cost against a page: the four ranges `openEdf` issues on
 * a 30 MB file, the one read and 15,380 bytes a three-channel window takes, the three reads and
 * then zero that `locate` costs, the records a validation sweep touches. Each is a specific file
 * with a number beside it, and each would keep passing if the rule behind it broke for every file
 * except the one in the example.
 *
 * This is the rule. For any well-formed continuous recording and any window that overlaps it,
 * `readWindow` issues exactly one read, and that read is a whole number of records — because a
 * record is the unit of I/O and every channel is interleaved into it. Those two sentences are the
 * whole cost model the documentation keeps restating, and nothing stated them in general.
 *
 * The overread is asserted as an identity rather than a bound. `byteLength` is not "about" the
 * window: it is exactly the records the chunk reports, whatever fraction of them the caller
 * wanted. That is what makes the number in the result trustworthy enough to publish, and it is
 * what a per-signal narrowing optimisation would quietly break while still returning the right
 * samples.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x1d0c;

interface Shape {
  readonly counts: readonly number[];
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
}

const shape = fc.record({
  counts: fc.array(fc.integer({ min: 1, max: 64 }), { minLength: 1, maxLength: 5 }),
  recordCount: fc.integer({ min: 1, max: 40 }),
  recordDurationSeconds: fc.constantFrom(0.5, 1, 2),
});

const build = (of: Shape): Uint8Array =>
  buildEdf({
    recordCount: of.recordCount,
    recordDurationSeconds: of.recordDurationSeconds,
    signals: of.counts.map((samplesPerRecord, index) => ({
      label: `C${index}`,
      samplesPerRecord,
    })),
  });

describe('a window over a continuous recording', () => {
  it('costs exactly one read, whatever it asks for', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0, max: 60, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds, durationSeconds) => {
          const spy = spySource(byteSource(build(of)));
          const recording = await openEdf(spy);
          const before = spy.reads.length;

          const chunks = await readWindow(recording, {
            startSeconds,
            durationSeconds,
            signalIndices: [...recording.header.dataSignalIndices],
          });

          // A window that falls outside the recording reads nothing: a zero-length range is not
          // expressible as an HTTP range, so there is nothing to ask for.
          fc.pre(chunks.length > 0);
          expect(spy.reads.length - before).toBe(1);
        },
      ),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('reads a whole number of records, and exactly the ones the chunk reports', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0, max: 60, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds, durationSeconds) => {
          const recording = await openEdf(byteSource(build(of)));
          const chunks = await readWindow(recording, {
            startSeconds,
            durationSeconds,
            signalIndices: [...recording.header.dataSignalIndices],
          });
          fc.pre(chunks.length > 0);

          const { header } = recording;
          for (const chunk of chunks) {
            // An identity, not a bound: this is what makes `byteLength` worth publishing.
            expect(chunk.byteLength).toBe(chunk.records.count * header.recordByteLength);
            expect(chunk.byteOffset).toBe(
              header.headerByteLength + chunk.records.start * header.recordByteLength,
            );
            // And it never runs past the end of the file it came from.
            expect(chunk.records.start + chunk.records.count).toBeLessThanOrEqual(
              header.recordCount,
            );
          }
        },
      ),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('costs the same whether one channel is wanted or all of them', async () => {
    // The claim `reading-signals.md` tabulates for one file: de-interleaving happens after the
    // read, so naming fewer channels never narrows the range.
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds) => {
          const bytes = build(of);
          const selection = { startSeconds, durationSeconds: 5 };

          const all = spySource(byteSource(bytes));
          const wide = await openEdf(all);
          const wideChunks = await readWindow(wide, {
            ...selection,
            signalIndices: [...wide.header.dataSignalIndices],
          });
          fc.pre(wideChunks.length > 0);

          const one = spySource(byteSource(bytes));
          const narrow = await openEdf(one);
          const narrowChunks = await readWindow(narrow, {
            ...selection,
            signalIndices: [narrow.header.dataSignalIndices[0] ?? 0],
          });

          expect(narrowChunks[0]?.byteLength).toBe(wideChunks[0]?.byteLength);
          expect(one.reads.length).toBe(all.reads.length);
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });
});
