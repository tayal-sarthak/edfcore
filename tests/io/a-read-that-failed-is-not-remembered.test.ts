/**
 * A read that failed is not remembered as an answer.
 *
 * `index.onsetTicks(r)` reads one record and memoises the result, so `locate()` costs
 * `O(log recordCount)` reads rather than repeating them. Memoising is the whole reason the index
 * is an object with methods rather than a function, and it is also the classic place to store a
 * failure by accident: cache the PROMISE and one dropped connection is permanent, because every
 * later caller awaits the same rejection and no retry ever reaches the network.
 *
 * The distinction is invisible from the outside until the day the network hiccups. `cachedSource`
 * has the same exposure one layer down — it holds chunks, and holding a failed chunk would serve
 * the failure forever — and neither had a test where a read fails and is then tried again.
 *
 * A flaky source is the fixture: it rejects a stated number of times and then behaves. Every
 * question is asked twice, once while it is failing and once after, and the answer after has to be
 * the answer a source that never failed would have given.
 *
 * The other half is asserted too, because a package that simply never memoised would pass
 * everything above: a SUCCESSFUL read is remembered, and asking twice costs one read.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { ByteSource, ReadOptions } from '../../src/types.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

/** Eight records with real timekeeping, so `locate` has something to bisect. */
const FILE = buildEdf({
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** The caller's network, which is down and then is not. */
class Offline extends Error {
  readonly attempt: number;
  constructor(attempt: number) {
    super(`the connection dropped on read ${attempt}`);
    this.name = 'Offline';
    this.attempt = attempt;
  }
}

interface Flaky extends ByteSource {
  /** Reads to fail before behaving. Set it back to 0 to bring the network up. */
  failures: number;
  readonly attempts: number;
}

function flakySource(bytes: Uint8Array): Flaky {
  const inner = byteSource(bytes);
  let attempts = 0;
  const source = {
    byteLength: inner.byteLength,
    failures: 0,
    get attempts(): number {
      return attempts;
    },
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      attempts += 1;
      if (source.failures > 0) {
        source.failures -= 1;
        throw new Offline(attempts);
      }
      return inner.read(offset, length, options);
    },
  };
  return source as Flaky;
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('the call resolved, so there is no rejection to inspect');
}

describe('the source really is flaky, and its failure is the caller`s', () => {
  it('fails the reads it was told to and then behaves', async () => {
    const source = flakySource(FILE);
    source.failures = 1;
    const error = await rejection(() => openEdf(source));

    expect(error).toBeInstanceOf(Offline);
    // Not wrapped into a file problem: a dropped connection says nothing about the recording.
    expect(isEdfError(error)).toBe(false);
    await expect(openEdf(source)).resolves.toBeDefined();
  });
});

describe('an onset that failed can be asked for again', () => {
  it('rejects, then answers, and answers what a source that never failed would have', async () => {
    const source = flakySource(FILE);
    // The PROBED index `openEdf` builds, not the scanned one: a full scan has already read every
    // onset, so nothing would be left for a failing read to fail at.
    const recording = await openEdf(source);
    const index = recording.index;

    // Record 0 and the last record are probed during open, so ask for one in the middle.
    source.failures = 1;
    expect(await rejection(() => index.onsetTicks(4))).toBeInstanceOf(Offline);

    const recovered = await index.onsetTicks(4);
    const fresh = (await openEdf(byteSource(FILE))).index;
    expect(recovered).toBe(await fresh.onsetTicks(4));
  });

  it('does not answer the next caller with the rejection it kept', async () => {
    const source = flakySource(FILE);
    const index = (await openEdf(source)).index;

    source.failures = 1;
    await rejection(() => index.onsetTicks(3));

    // Three more callers, none of which should meet the failure the first one did.
    const answers = await Promise.all([
      index.onsetTicks(3),
      index.onsetTicks(3),
      index.onsetTicks(3),
    ]);
    expect(new Set(answers.map(String)).size).toBe(1);
  });

  it('lets locate() find the record it could not reach a moment ago', async () => {
    const source = flakySource(FILE);
    const recording = await openEdf(source);
    const index = recording.index;

    source.failures = 1;
    expect(await rejection(() => index.locate(4.5))).toBeInstanceOf(Offline);

    const located = await index.locate(4.5);
    const fresh = (await openEdf(byteSource(FILE))).index;
    expect(located).toEqual(await fresh.locate(4.5));
  });
});

describe('and a window that failed can be read again', () => {
  it('gives the same samples the second time as a recording that never failed', async () => {
    const source = flakySource(FILE);
    const recording = await openEdf(source);
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const selection = { startSeconds: 2, durationSeconds: 3, signalIndices: [0] };

    source.failures = 1;
    expect(await rejection(() => readWindow(located, selection))).toBeInstanceOf(Offline);

    const recovered = await readWindow(located, selection);
    const freshRecording = await openEdf(byteSource(FILE));
    const fresh = await readWindow(
      { ...freshRecording, index: await buildRecordIndex(freshRecording) },
      selection,
    );
    expect(recovered).toEqual(fresh);
  });

  it('holds through cachedSource, which would otherwise serve the failure forever', async () => {
    // A cache is where a stored failure does the most damage, and it has to be provoked at the
    // FIRST read: this source coalesces a small file into one range, so by the time a recording is
    // open there is nothing left for a later read to fail at.
    const flaky = flakySource(FILE);
    const cached = cachedSource(flaky);

    flaky.failures = 1;
    expect(await rejection(() => openEdf(cached))).toBeInstanceOf(Offline);

    // The same cache object, which must have kept nothing from the attempt that failed.
    const recording = await openEdf(cached);
    const selection = { startSeconds: 5, durationSeconds: 2, signalIndices: [0] };
    const first = await readWindow(recording, selection);

    const fresh = await openEdf(cachedSource(byteSource(FILE)));
    expect(first).toEqual(await readWindow(fresh, selection));

    // And it is a cache afterwards: the same window again reads nothing new.
    const before = flaky.attempts;
    expect(await readWindow(recording, selection)).toEqual(first);
    expect(flaky.attempts).toBe(before);
  });
});

describe('a read that SUCCEEDED is remembered, so none of the above is a package that never caches', () => {
  it('costs one read for two calls to onsetTicks on the same record', async () => {
    const spy = spySource(byteSource(FILE));
    const index = (await openEdf(spy)).index;

    const before = spy.reads.length;
    const first = await index.onsetTicks(4);
    const between = spy.reads.length;
    const second = await index.onsetTicks(4);

    expect(second).toBe(first);
    expect(between).toBeGreaterThan(before);
    expect(spy.reads.length).toBe(between);
  });

  it('refuses a range that cannot exist without reading at all, failure or not', async () => {
    const source = flakySource(FILE);
    const index = (await openEdf(source)).index;
    const before = source.attempts;

    const error = await rejection(() => index.onsetTicks(99));
    // A caller mistake, answered from the header. Nothing was asked of the network, so nothing
    // about it depends on whether the network is up.
    expect(error).not.toBeInstanceOf(Offline);
    expect(error).not.toBeInstanceOf(EdfSourceError);
    expect(source.attempts).toBe(before);
  });
});
