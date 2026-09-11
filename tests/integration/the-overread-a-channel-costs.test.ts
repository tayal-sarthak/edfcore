/**
 * The single-channel overread, measured, against the two places that state it.
 *
 * `io/read.ts` states the unit-of-I/O rule as one of "two rules [that] are the whole file", and
 * quantified it: "ten seconds of one channel out of thirty is a 27x overread spread over ten
 * requests, against a single 153,600-byte read for all thirty".
 *
 * That is neither strategy and neither number. The read edfcore issues is ONE request of 153,600
 * bytes, of which 5,120 are the channel asked for — a factor of 30. The ten-request alternative
 * is the one that does NOT overread: ten stripes of 512 bytes, 5,120 bytes in total, at the cost
 * of ten round trips. `large-files.md` works the same window through both and says "Overread
 * factor: 30" (fixed in 0.6.73).
 *
 * A number in a docblock about cost is read by exactly the caller planning HTTP range requests,
 * which is what the module exists for. Everything below is measured through a counting source.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const MODULE = readFileSync(new URL('../../src/io/read.ts', import.meta.url), 'utf8');
const PAGE = (DOCS_PAGES.get('large-files.md') ?? '').replace(/\s+/g, ' ');

/** Thirty channels at 256 Hz in one-second records: the file both statements describe. */
const THIRTY_CHANNELS = buildEdf({
  recordCount: 60,
  recordDurationSeconds: 1,
  signals: Array.from({ length: 30 }, (_, index) => ({
    label: `Ch${index}`,
    samplesPerRecord: 256,
  })),
});

const WINDOW = { startSeconds: 10, durationSeconds: 10 } as const;

async function readOne(signalIndices: readonly number[]) {
  const spy = spySource(byteSource(THIRTY_CHANNELS));
  const recording = await openEdf(spy);
  const before = spy.reads.length;
  const [chunk] = await readWindow(recording, { ...WINDOW, signalIndices });
  if (chunk === undefined) throw new Error('that window selected no records');
  return {
    chunk,
    requests: spy.reads.length - before,
    recordByteLength: recording.header.recordByteLength,
  };
}

describe('ten seconds of one channel out of thirty', () => {
  it('is the file the two statements describe', async () => {
    const { recordByteLength } = await readOne([0]);
    expect(recordByteLength).toBe(15_360);
  });

  it('is one request, not ten', async () => {
    expect((await readOne([0])).requests).toBe(1);
  });

  it('reads 153,600 bytes for 5,120 of interest — a factor of 30, not 27', async () => {
    const { chunk } = await readOne([0]);
    expect(chunk.byteLength).toBe(153_600);
    const wanted = (chunk.signals[0]?.sampleCount ?? 0) * 2;
    expect(wanted).toBe(5_120);
    expect(chunk.byteLength / wanted).toBe(30);
  });

  it('costs exactly what all thirty cost, which is the rule being stated', async () => {
    const one = await readOne([0]);
    const all = await readOne(Array.from({ length: 30 }, (_, index) => index));
    expect(one.chunk.byteLength).toBe(all.chunk.byteLength);
    expect(one.requests).toBe(all.requests);
  });
});

describe('the two places that state it', () => {
  it('has the page saying 30', () => {
    expect(PAGE).toContain('Overread factor: 30');
  });

  it('no longer has the module saying 27', () => {
    expect(MODULE).not.toContain('27x overread spread over ten requests, against');
  });

  it('has the module attaching each number to the strategy it belongs to', () => {
    const head = MODULE.slice(0, MODULE.indexOf('\n */'));
    expect(head).toContain('one request, 30x overread');
    expect(head).toContain('ten requests of 512 bytes, no overread at all');
  });
});
