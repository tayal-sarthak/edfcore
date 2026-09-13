/**
 * A signal selection that names the same channel twice, in two spellings.
 *
 * `a-selection-from-json.test.ts` names the one shape accepted by coercion — an array holding the
 * canonical decimal string for an index, "which is what `JSON.parse('[\"0\"]')` from a query
 * string gives" — and argues it is safe: the coercion is tight, and "the chunk that comes back
 * reports `signalIndex` as a number, so nothing downstream carries the string". Both hold.
 *
 * What neither covers is the MIXED array, and mixing is how the string arrives in the first place:
 * a numeric default merged with `Object.keys()`, a saved view, or a query parameter. Deduplication
 * kept the values as WRITTEN in a `Set<number>`, and `'0'` is not `0` — so `[0, '0']` was
 * deduplicated against nothing. The same channel was read twice, its bytes decoded twice, and it
 * came back twice in `chunk.signals`, both entries reporting `signalIndex: 0`. A caller plotting
 * `chunk.signals` drew one trace twice, and nothing in the result said which was the copy.
 *
 * The fix is where the deduplication looks: at the index the selection RESOLVED to rather than at
 * the value that was written. Nothing about which selections are accepted changes.
 *
 * `envelope.ts` walks its own copy of the loop, so both are checked here — one of the two fixed
 * would mean `readEnvelope` and `readWindow` returning different numbers of signals for the same
 * selection.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'A2', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

/** Every call that resolves a signal selection, and the signal indices each one comes back with. */
const RESOLVERS: ReadonlyArray<
  readonly [string, (r: EdfRecording, indices: readonly number[]) => Promise<readonly number[]>]
> = [
  [
    'readWindow',
    async (r, signalIndices) =>
      (await readWindow(r, { signalIndices, startSeconds: 0, durationSeconds: 1 }))[0]?.signals.map(
        (s) => s.signalIndex,
      ) ?? [],
  ],
  [
    'readRecords',
    async (r, signalIndices) =>
      (await readRecords(r, { signalIndices, records: { start: 0, count: 1 } })).signals.map(
        (s) => s.signalIndex,
      ),
  ],
  [
    'readEnvelope',
    async (r, signalIndices) =>
      (
        await readEnvelope(r, { signalIndices, startSeconds: 0, durationSeconds: 1, buckets: 4 })
      )[0]?.signals.map((s) => s.signalIndex) ?? [],
  ],
  [
    'streamRecords',
    async (r, signalIndices) => {
      const first = await streamRecords(r, {
        signalIndices,
        startSeconds: 0,
        durationSeconds: 1,
      }).next();
      return (first.value?.signals ?? []).map((s) => s.signalIndex);
    },
  ],
];

/** The string spelling, cast the way a JavaScript caller reaches this without one. */
const asIndex = (text: string): number => text as unknown as number;

describe.each(RESOLVERS)('%s given the same channel in two spellings', (_name, resolve) => {
  it('returns it once, not twice', async () => {
    expect(await resolve(await opened(), [0, asIndex('0')])).toEqual([0]);
  });

  it('keeps the other spelling from displacing a real second channel', async () => {
    expect(await resolve(await opened(), [0, asIndex('0'), 1])).toEqual([0, 1]);
  });

  it('deduplicates the string against itself too', async () => {
    expect(await resolve(await opened(), [asIndex('1'), asIndex('1')])).toEqual([1]);
  });

  it('still collapses a genuine numeric duplicate, which is what it always did', async () => {
    expect(await resolve(await opened(), [0, 0, 1])).toEqual([0, 1]);
  });

  it('still reads what was asked for, in the order given', async () => {
    expect(await resolve(await opened(), [1, 0])).toEqual([1, 0]);
  });
});

describe('the coercion itself is unchanged', () => {
  it('still resolves the canonical decimal string on its own', async () => {
    const chunk = await readRecords(await opened(), {
      signalIndices: [asIndex('1')],
      records: { start: 0, count: 1 },
    });
    expect(chunk.signals.map((s) => s.signalIndex)).toEqual([1]);
    expect(typeof chunk.signals[0]?.signalIndex).toBe('number');
  });

  it('still refuses an index the file does not have, from either spelling', async () => {
    for (const value of [9, asIndex('9')]) {
      await expect(
        readRecords(await opened(), {
          signalIndices: [value],
          records: { start: 0, count: 1 },
        }),
      ).rejects.toThrow(/is outside the 3 signals this file declares/);
    }
  });

  it('still refuses the annotations channel, whichever spelling names it', async () => {
    for (const value of [2, asIndex('2')]) {
      await expect(
        readRecords(await opened(), {
          signalIndices: [value],
          records: { start: 0, count: 1 },
        }),
      ).rejects.toThrow(/annotations channel/);
    }
  });
});
