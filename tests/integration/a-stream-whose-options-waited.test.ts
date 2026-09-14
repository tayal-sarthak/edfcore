/**
 * The one argument `streamRecords` still handed to the generator unchecked.
 *
 * 0.6.118 turned this from an `async function*` into a plain function that validates and returns
 * one, because "a pipeline that builds the stream in one function and consumes it in another gets
 * the refusal in the second, with the arguments it names nowhere in sight". It listed what is
 * answerable without reading — the recording, the selection, the chunk size, the signal indices,
 * the window — and the options were not on that list.
 *
 * They are answerable. `readRecords` refuses a bare value where the options belong (0.6.155 for an
 * `AbortSignal`, 0.6.166 for anything else), but it is the generator that calls it, so the refusal
 * arrived on the first `for await` rather than at the call the mistake is in.
 *
 * On an EMPTY window it never arrived at all. A window past the end, one inside an EDF+D gap and
 * one of zero duration all resolve to no records, so the loop body never runs and nothing is ever
 * passed to `readRecords`: the stream completed, yielding nothing, with the options silently
 * dropped. Whether a caller mistake was reported depended on where the window landed — the
 * data-dependent guard 0.6.118 found in this same function, one argument over.
 *
 * The `AbortSignal` case is the one that costs most, and it is the pair that cannot be told apart:
 * a signal passed where the options belong is a cancellation that was never wired up, and a stream
 * that yields nothing is what an abort looks like from the outside.
 */

import { describe, expect, it } from 'vitest';
import { openEdf } from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const recording = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

/** In the file, so the generator would have read something. */
const COVERED = { signalIndices: [0], startSeconds: 0, durationSeconds: 4 };
/** Past the end, so the generator would have read nothing and reported nothing. */
const EMPTY = { signalIndices: [0], startSeconds: 500, durationSeconds: 4 };

const build = (recording: EdfRecording, selection: unknown, options: unknown): unknown =>
  (
    streamRecords as unknown as (
      r: EdfRecording,
      s: unknown,
      o: unknown,
    ) => AsyncGenerator<EdfChunk>
  )(recording, selection, options);

describe('a bare value where the read options belong', () => {
  it('is refused by the call, not by the first for await', async () => {
    const rec = await recording();
    expect(() => build(rec, COVERED, 64 * 1024 * 1024)).toThrow(/the read options are 67108864/);
  });

  it('is refused on a window with nothing in it, where no read would have happened', async () => {
    const rec = await recording();
    // The proof that the window is genuinely empty: with real options it yields no chunks at all,
    // so before this check there was nothing on the path that could have looked at them.
    let yielded = 0;
    for await (const _chunk of streamRecords(rec, EMPTY)) yielded += 1;
    expect(yielded).toBe(0);

    expect(() => build(rec, EMPTY, 64 * 1024 * 1024)).toThrow(RangeError);
  });

  it('names an AbortSignal as one, so a dropped cancellation is not read as a quiet stream', async () => {
    const rec = await recording();
    const controller = new AbortController();
    for (const selection of [COVERED, EMPTY]) {
      try {
        build(rec, selection, controller.signal);
        expect.unreachable('a signal passed as the options must not be taken as no options');
      } catch (error) {
        expect((error as Error).message).toContain('the read options are an AbortSignal');
        expect((error as Error).message).toContain('Next: pass the signal as options.signal');
      }
    }
  });
});

describe('what the options actually are', () => {
  it('still streams with real options, and with none', async () => {
    const rec = await recording();
    const controller = new AbortController();
    const counts: number[] = [];
    for (const options of [
      undefined,
      { signal: controller.signal, maxMaterializeBytes: 1 << 20 },
    ]) {
      let chunks = 0;
      for await (const _chunk of streamRecords(rec, COVERED, options)) chunks += 1;
      counts.push(chunks);
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBe(counts[0]);
  });
});
