/**
 * `decodeAnnotations` given its origin in seconds rather than ticks.
 *
 * `startOffsetTicks` and `originTicks` are the only BigInt options a caller of this package ever
 * passes in, and both name the same thing: record 0's sub-second start offset, the origin every
 * `onsetTicksFromFirstRecord` is measured from.
 *
 * Both have a float sibling one field away. `timeline.startOffsetSeconds` sits directly beside
 * `timeline.startOffsetTicks`, and the seconds are the one a reader reaches for — so a number went
 * into the rebasing arithmetic and came back as V8's `Cannot mix BigInt and other types, use
 * explicit conversions`: a sentence about types, with no `Next:` clause and nothing naming the
 * option, out of a decoder.
 *
 * 0.6.112 made this exact argument for `recordDurationTicks` in the sample-grid family — "the
 * seconds beside it on the same header are a float, and this family is exact on purpose". These two
 * were the last tick options in the package that took whatever arrived.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfHeader, EdfTimeline } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const RECORDS = { start: 0, count: 4 } as const;

/** A quarter-second start offset, so the origin is a number that actually changes the answer. */
const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  startOffsetSeconds: 0.25,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r}`] }] },
  ],
});

async function pieces(): Promise<{
  header: EdfHeader;
  timeline: EdfTimeline;
  bytes: Uint8Array;
}> {
  const recording = await openEdf(byteSource(FILE));
  return {
    header: recording.header,
    timeline: recording.timeline,
    bytes: await readRecordBytes(recording.source, recording.header, RECORDS),
  };
}

const OPTIONS = ['startOffsetTicks', 'originTicks'] as const;

describe.each(OPTIONS)('%s', (name) => {
  it.each([
    ['the seconds beside it', 0.25],
    ['a whole number of ticks, as a number', 2500000],
    ['zero', 0],
    ['a string', '2500000'],
  ])('is refused when given %s', async (_shape, value) => {
    const { header, bytes } = await pieces();
    let thrown: Error | undefined;
    try {
      decodeAnnotations(header, bytes, RECORDS, { [name]: value } as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the origin went into the arithmetic').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown?.message).not.toContain('Cannot mix BigInt');
    expect(thrown?.message).toContain(`options.${name} is`);
    expect(thrown?.message).toContain('not a BigInt');
    expect(thrown?.message).toContain('Next: pass timeline.startOffsetTicks');
  });

  it('says why the seconds cannot stand in for it', async () => {
    const { header, bytes } = await pieces();
    expect(() => decodeAnnotations(header, bytes, RECORDS, { [name]: 0.25 } as never)).toThrow(
      /the seconds beside it are a float/,
    );
  });
});

describe('the BigInt itself', () => {
  it('is what the file actually declares, so the option changes the answer', async () => {
    const { timeline } = await pieces();
    expect(timeline.startOffsetTicks).toBe(2500000n);
  });

  it('still rebases the onsets when passed as ticks', async () => {
    const { header, bytes, timeline } = await pieces();
    const rebased = decodeAnnotations(header, bytes, RECORDS, {
      startOffsetTicks: timeline.startOffsetTicks,
    }).annotations;
    expect(rebased.map((event) => event.onsetTicksFromFirstRecord)).toEqual([
      0n,
      10000000n,
      20000000n,
      30000000n,
    ]);
  });

  it('still decodes with no options at all', async () => {
    const { header, bytes } = await pieces();
    expect(decodeAnnotations(header, bytes, RECORDS).annotations.length).toBe(4);
  });

  it('still accepts an option explicitly set to undefined', async () => {
    const { header, bytes } = await pieces();
    expect(
      decodeAnnotations(header, bytes, RECORDS, { originTicks: undefined } as never).annotations
        .length,
    ).toBe(4);
  });

  it('still reaches readAnnotations, which passes the ticks for you', async () => {
    const recording = await openEdf(byteSource(FILE));
    const { annotations } = await (await import('../../../src/recording.js')).readAnnotations(
      recording,
      RECORDS,
    );
    expect(annotations[0]?.onsetTicksFromFirstRecord).toBe(0n);
  });
});
