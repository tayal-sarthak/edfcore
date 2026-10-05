/**
 * "That is an envelope signal", said to four things that were not one.
 *
 * `assertChunkSignal` tested the ABSENCE of a typed-array `digital` and then declared the argument an
 * envelope signal. Its own comment names what actually separates the two shapes — they "differ only
 * in the one that holds the data: `digital` against `min`/`max`/`counts`" — and then inferred the
 * second from the lack of the first.
 *
 * So everything with a numeric `signalIndex` and any other `digital` was told it was an envelope. Of
 * the five arguments that reach the branch, exactly one was.
 *
 * The costly route is JSON. `JSON.stringify` writes an `Int32Array` as `{"0":1,"1":2}`, so a chunk
 * out of a cache, a saved session, or a `postMessage` that serialises as JSON arrives with its
 * samples intact and its container gone. `chunks.ts` names that route for this package already —
 * "`null` as well as `undefined`, because JSON is how a hole arrives" — and `design-decisions.md`
 * says it of a chunk: "what parses back has no `.length` where a caller expects one".
 *
 * The advice was the expensive half: "readEnvelope() has already reduced its samples away", said to
 * someone who still has every sample, and who did pass one element of `chunk.signals` from
 * `readWindow()`. It sent them to look at a call they had not made.
 *
 * The guard now tests for `min`, `max` and `counts`, so an envelope signal is identified by what it
 * carries. `ArrayBuffer.isView` throughout, which is a brand check and so holds across a realm
 * boundary — the rule 0.6.284 and 0.6.285 applied elsewhere (0.6.291).
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfEnvelopeSignal, EdfHeader } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

async function fixture(): Promise<{
  header: EdfHeader;
  chunkSignal: EdfChunkSignal;
  envelopeSignal: EdfEnvelopeSignal;
}> {
  const recording = await openEdf(
    byteSource(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 })),
  );
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 4,
  });
  const envelopes = await readEnvelope(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 4,
    buckets: 4,
  });
  const chunkSignal = chunks[0]?.signals[0];
  const envelopeSignal = envelopes[0]?.signals[0];
  if (chunkSignal === undefined || envelopeSignal === undefined) throw new Error('fixture');
  return { header: recording.header, chunkSignal, envelopeSignal };
}

/** What a chunk signal becomes through `JSON.stringify` — the route the docs already name. */
function throughJson(chunkSignal: EdfChunkSignal): EdfChunkSignal {
  return JSON.parse(
    JSON.stringify(chunkSignal, (_key, value) =>
      typeof value === 'bigint' ? String(value) : value,
    ),
  ) as EdfChunkSignal;
}

describe('a chunk signal whose digital is not an Int32Array', () => {
  it('is what JSON really produces: the samples kept, the container gone', async () => {
    const { chunkSignal } = await fixture();
    const parsed = throughJson(chunkSignal);
    expect(typeof parsed.signalIndex).toBe('number');
    expect(ArrayBuffer.isView(parsed.digital)).toBe(false);
    // All forty samples are still there, which is why "reduced its samples away" was wrong.
    expect(Object.keys(parsed.digital).length).toBe(40);
  });

  it('is named by its digital rather than called an envelope', async () => {
    const { header, chunkSignal } = await fixture();
    const parsed = throughJson(chunkSignal);
    for (const [name, drive] of [
      ['trimToWindow', () => trimToWindow(header, parsed, 0, 1)],
      ['envelopeOfSamples', () => envelopeOfSamples(parsed, 2)],
    ] as const) {
      expect(drive, name).toThrow(/the chunk signal's `digital` is an object/);
      expect(drive, name).not.toThrow(/that is an envelope signal/);
    }
  });

  it('names each of the other three the same way', async () => {
    const { header, chunkSignal } = await fixture();
    const cases: ReadonlyArray<readonly [string, unknown, RegExp]> = [
      ['a plain array', Array.from(chunkSignal.digital), /`digital` is an object/],
      ['undefined', undefined, /`digital` is undefined/],
      ['a pending Promise', Promise.resolve(chunkSignal.digital), /`digital` is a pending Promise/],
    ];
    for (const [what, digital, expected] of cases) {
      const given = { ...chunkSignal, digital } as unknown as EdfChunkSignal;
      expect(() => trimToWindow(header, given, 0, 1), what).toThrow(expected);
      expect(() => trimToWindow(header, given, 0, 1), what).not.toThrow(/an envelope signal/);
    }
  });

  it('sends them to rebuild the samples, not to a call they never made', async () => {
    const { header, chunkSignal } = await fixture();
    let message = '';
    try {
      trimToWindow(header, throughJson(chunkSignal), 0, 1);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Next: pass one element of chunk\.signals/);
    expect(message).toMatch(/new Int32Array\(Object\.values\(digital\)\)/);
    expect(message).not.toMatch(/readEnvelope\(\) has already reduced/);
  });

  it('and the rebuilt signal is accepted, so the advice works', async () => {
    const { header, chunkSignal } = await fixture();
    const parsed = throughJson(chunkSignal);
    const rebuilt = {
      ...chunkSignal,
      digital: new Int32Array(Object.values(parsed.digital as unknown as Record<string, number>)),
    };
    const trimmed = trimToWindow(header, rebuilt, 0, 1);
    expect(trimmed.sampleCount).toBe(10);
    expect([...trimmed.digital]).toEqual([...chunkSignal.digital.subarray(0, 10)]);
  });

  it('still calls a real envelope signal an envelope signal', async () => {
    const { header, envelopeSignal } = await fixture();
    const given = envelopeSignal as unknown as EdfChunkSignal;
    expect(() => trimToWindow(header, given, 0, 1)).toThrow(/that is an envelope signal/);
    expect(() => envelopeOfSamples(given, 2)).toThrow(
      /an envelope carries the smallest and largest sample of each bucket/,
    );
  });

  it('still refuses a header signal and a value with no signalIndex at all', async () => {
    const { header, chunkSignal } = await fixture();
    expect(() => trimToWindow(header, header.signals[0] as never, 0, 1)).toThrow(
      /a header signal, which carries no samples to trim/,
    );
    expect(() => trimToWindow(header, undefined as never, 0, 1)).toThrow(
      /the signal is undefined with no signalIndex on it/,
    );
    // And the real one still passes, unchanged.
    expect(trimToWindow(header, chunkSignal, 0, 1).sampleCount).toBe(10);
  });
});
