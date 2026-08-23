/**
 * "Duplicates are dropped; the order you give is the order of `chunk.signals`."
 *
 * That is the whole of what `api-reading.md` says about the shape of `signalIndices`, in the
 * options table every reader consults before their first read. It was prose.
 *
 * Both halves are reached by ordinary code. A repeated index comes from a multi-select that
 * appends on click, a "select all" over a list that already had one checked, a URL parameter
 * merged with a default, or `[...montage, ...extras]` where the two overlap. The order comes from
 * wherever the indices were built — `Object.keys`, a `Set`, a sequence of `getSignal` calls — and
 * a caller who draws `chunk.signals[0]` as the top trace is trusting it.
 *
 * The two claims fail differently and both quietly. A duplicate that is NOT dropped costs a
 * second decode of the same channel and hands back an array with one more entry than the caller's
 * legend has rows, so every trace below the repeat is drawn with the wrong label. An order that
 * is not preserved swaps two traces outright — and on a montage, two channels of EEG look like
 * two channels of EEG.
 *
 * `readRecords`, `readWindow` and `streamRecords` share one resolver, deliberately: `stream.ts`
 * says it must produce the byte-identical refusal `readWindow` does. So all three are checked
 * here, because sharing a resolver is a fact about today's code and the promise is about the API.
 *
 * What this does NOT check: `readEnvelope`, which has a resolver of its own and is pinned by
 * `envelope-degenerate.test.ts` for the same two claims.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

/** Four channels, so an order exists to get wrong and a duplicate has somewhere to hide. */
const FOUR = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [0, 1, 2, 3].map((at) => ({ label: `C${at}`, samplesPerRecord: 8 })),
});

const open = (): Promise<EdfRecording> => openEdf(byteSource(FOUR));

const indicesOf = (signals: readonly { readonly signalIndex: number }[]): readonly number[] =>
  signals.map((one) => one.signalIndex);

describe('the page still makes the claim', () => {
  it('says both halves of it in one sentence', () => {
    expect((DOCS_PAGES.get('api-reading.md') ?? '').replace(/\s+/g, ' ')).toContain(
      'Duplicates are dropped; the order you give is the order of `chunk.signals`',
    );
  });
});

describe('a repeated index', () => {
  it('is read once by readRecords', async () => {
    const recording = await open();
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [2, 2, 0, 2],
    });
    expect(indicesOf(chunk.signals)).toEqual([2, 0]);
  });

  it('is read once by readWindow', async () => {
    const recording = await open();
    const [chunk] = await readWindow(recording, {
      signalIndices: [1, 1, 3],
      startSeconds: 0,
      durationSeconds: 4,
    });
    expect(indicesOf(chunk?.signals ?? [])).toEqual([1, 3]);
  });

  it('is read once by streamRecords, in every chunk it yields', async () => {
    const recording = await open();
    const seen: (readonly number[])[] = [];
    for await (const chunk of streamRecords(recording, {
      signalIndices: [0, 0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      chunkRecords: 1,
    })) {
      seen.push(indicesOf(chunk.signals));
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((one) => one.length === 2)).toBe(true);
    expect(seen[0]).toEqual([0, 1]);
  });

  it('costs what naming it once costs', async () => {
    const measure = async (signalIndices: readonly number[]): Promise<number> => {
      const spy = spySource(byteSource(FOUR));
      const recording = await openEdf(spy);
      const before = spy.bytesRead;
      await readRecords(recording, { records: { start: 0, count: 4 }, signalIndices });
      return spy.bytesRead - before;
    };
    expect(await measure([0, 0, 0, 0, 1])).toBe(await measure([0, 1]));
  });

  it('does not change the samples the caller gets', async () => {
    const recording = await open();
    const once = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [3, 1],
    });
    const twice = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [3, 3, 1, 1, 3],
    });
    expect(indicesOf(twice.signals)).toEqual(indicesOf(once.signals));
    expect([...(twice.signals[0]?.digital ?? [])]).toEqual([...(once.signals[0]?.digital ?? [])]);
    expect([...(twice.signals[1]?.digital ?? [])]).toEqual([...(once.signals[1]?.digital ?? [])]);
  });
});

describe('the order given', () => {
  it.each([
    [
      [0, 1, 2, 3],
      [0, 1, 2, 3],
    ],
    [
      [3, 2, 1, 0],
      [3, 2, 1, 0],
    ],
    [
      [2, 0],
      [2, 0],
    ],
    // First mention wins, which is the only reading of "dropped" that keeps the order claim true.
    [
      [3, 1, 3, 0, 1],
      [3, 1, 0],
    ],
  ] as ReadonlyArray<readonly [readonly number[], readonly number[]]>)(
    'is kept: %j comes back as %j',
    async (given, expected) => {
      const recording = await open();
      const chunk = await readRecords(recording, {
        records: { start: 0, count: 1 },
        signalIndices: given,
      });
      expect(indicesOf(chunk.signals)).toEqual(expected);
    },
  );

  it('is the order the samples come back in, not just the labels', async () => {
    const recording = await open();
    // Every channel has its own ramp, so a swapped pair is visible in the values.
    const forwards = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [0, 3],
    });
    const backwards = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [3, 0],
    });
    expect([...(backwards.signals[0]?.digital ?? [])]).toEqual([
      ...(forwards.signals[1]?.digital ?? []),
    ]);
    expect([...(backwards.signals[1]?.digital ?? [])]).toEqual([
      ...(forwards.signals[0]?.digital ?? []),
    ]);
  });
});
