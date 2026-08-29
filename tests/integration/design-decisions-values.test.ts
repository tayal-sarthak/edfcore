/**
 * The values `design-decisions.md` prints beside three of its decisions.
 *
 * `AGENTS.md` sends every contributor to that page before proposing an architectural change —
 * "most obvious improvements were considered and rejected for a stated reason" — so it is the one
 * document read specifically to be argued with. Each decision is stated, then demonstrated with a
 * snippet, and `design-absences.test.ts` checks the ABSENCES it claims: no `Date`, no
 * `{ physical: true }` flag, no clamping on read.
 *
 * What nothing checked is the demonstrations. A decision whose example no longer produces what it
 * prints is worse than an undocumented one, because a reader weighing the trade-off is reading the
 * example to decide whether the cost is what the page says it is.
 *
 * Three are executed here, chosen because each is the evidence for a rejection rather than an
 * illustration of an accepted design:
 *
 *  - the start time as fields, which is the argument against returning a `Date`;
 *  - the onset as exact ticks beside its lossy seconds, which is the argument against `parseFloat`;
 *  - `clampToDigitalRange` as a separate pure function, which is the argument against clamping on
 *    read the way the reference implementation does.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clampToDigitalRange } from '../../src/decode/physical.js';
import { formatStartTimeNaive } from '../../src/header/dates.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('design-decisions.md') ?? '';

describe('the start time, as fields rather than as a Date', () => {
  it('is the clock, the date and the naive string the page prints', async () => {
    const bytes = minimalEdfPlus({
      recordCount: 2,
      recordDurationSeconds: 1,
      startDate: '01.01.20',
      startTime: '10.00.00',
      recordingId: 'Startdate 01-JAN-2020 X X X',
    });
    const recording = await openEdf(byteSource(bytes));

    expect(recording.header.startTime.clock).toEqual({ hour: 10, minute: 0, second: 0 });
    expect(recording.header.startTime.resolvedDate).toEqual({ year: 2020, month: 1, day: 1 });

    const printed = /formatStartTimeNaive\(recording\.header\.startTime\);\s*\/\/ '([^']+)'/.exec(
      PAGE,
    )?.[1];
    expect(formatStartTimeNaive(recording.header.startTime)).toBe(printed);
    // "The formatter emits no zone designator, because there is none to emit."
    expect(printed).not.toMatch(/[Zz]$|[+-]\d\d:\d\d$/);
  });

  it('uses a 1-based month, as the sentence under the snippet says', async () => {
    // A JavaScript month index would make January 0, and the page would be printing a February
    // recording as January.
    const bytes = minimalEdfPlus({
      recordCount: 1,
      recordDurationSeconds: 1,
      startDate: '01.02.20',
      startTime: '10.00.00',
    });
    const { header } = await openEdf(byteSource(bytes));
    expect(header.startTime.resolvedDate?.month).toBe(2);
  });
});

describe('an event time, as exact ticks', () => {
  it('is the tick count the page prints, and the seconds beside it', async () => {
    const bytes = minimalEdfPlus({
      recordCount: 20,
      recordDurationSeconds: 1,
      annotationSignals: [
        {
          samplesPerRecord: 40,
          tals: (record: number) =>
            record === 13 ? [{ onset: 13.25, texts: ['Lights off'] }] : [],
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 20 });
    const event = annotations[0];

    const ticks = /annotation\.onsetTicks;\s*\/\/ (\d+)n/.exec(PAGE)?.[1];
    expect(event?.onsetTicks).toBe(BigInt(ticks as string));
    expect(event?.onsetSecondsFromHeaderStart).toBe(
      Number(/annotation\.onsetSecondsFromHeaderStart;\s*\/\/ ([\d.]+)/.exec(PAGE)?.[1]),
    );
    // "TICKS_PER_SECOND is 10000000n" — the two numbers are one value in two units.
    expect(event?.onsetTicks).toBe(
      BigInt(Math.round((event?.onsetSecondsFromHeaderStart ?? 0) * 1e7)),
    );
  });
});

describe('clamping, as a separate pure function', () => {
  it('produces the array the page prints', async () => {
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4, digitalMinimum: -2048, digitalMaximum: 2047 }],
    });
    const { header } = await openEdf(byteSource(bytes));
    const signal = header.signals[0];
    if (signal === undefined) throw new Error('fixture has no signal');

    // `clampToDigitalRange(signal, Int32Array.from([-5000, 0, 5000]));   // Int32Array [-2048, 0, 2047]`
    const printed =
      /clampToDigitalRange\(signal, Int32Array\.from\(\[([-\d, ]+)\]\)\);\s*\/\/ Int32Array \[([-\d, ]+)\]/.exec(
        PAGE,
      );
    expect(printed, 'no clamp example on design-decisions.md').not.toBeNull();
    const input = (printed?.[1] ?? '').split(',').map((entry) => Number(entry.trim()));
    const expected = (printed?.[2] ?? '').split(',').map((entry) => Number(entry.trim()));

    expect(Array.from(clampToDigitalRange(signal, Int32Array.from(input)))).toEqual(expected);
    // The declared range, which is what the comment above the snippet says it clamps to.
    expect([signal.digitalMinimum, signal.digitalMaximum]).toEqual([expected[0], expected[2]]);
  });

  it('is not on the read path, which is the decision itself', async () => {
    // "Nothing on the read path calls this." A decode of the same file keeps the values.
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 3,
          digitalMinimum: -2048,
          digitalMaximum: 2047,
          sample: (_record: number, index: number) => [-5000, 0, 5000][index] ?? 0,
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));
    const chunk = await readRecordsFor(recording);
    expect(Array.from(chunk)).toEqual([-5000, 0, 5000]);
  });
});

/** One record of signal 0, decoded, so the read path can be compared with the clamp. */
async function readRecordsFor(recording: Awaited<ReturnType<typeof openEdf>>): Promise<Int32Array> {
  const { readRecords } = await import('../../src/recording.js');
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 1 },
    signalIndices: [0],
  });
  const series = chunk.signals[0];
  if (series === undefined) throw new Error('no signal in the chunk');
  return series.digital;
}

// ---------------------------------------------------------------------------
// How many ways a scale can be refused, counted in three places
// ---------------------------------------------------------------------------

/**
 * "Four header conditions ... A fifth condition catches a derived gain."
 *
 * `design-decisions.md` counts the refusals one way and `physical-values.md` tabulates them
 * another — five rows under "Five conditions produce it, checked in this order" — and
 * `header/scale.ts` is what actually decides. Three statements of one number, and only one of them
 * was checked: `scaling-page-arithmetic.test.ts` runs the table, and nothing tied the decision
 * record to it.
 *
 * The split wording is deliberate rather than stale. Four of the five are conditions a header
 * DECLARES and a reader can see in the fields; the fifth is a property of the gain those fields
 * imply, which no field states, so calling it a header condition would be wrong. What has to hold
 * is that four plus one is the five the other page tabulates and the five the source refuses in —
 * and that is the part a later release breaks by adding a sixth to one place.
 *
 * The refusal sites are counted from `header/scale.ts` the same way `physical.test.ts` counts them,
 * so all three move together or this fails.
 */
const DECISIONS = DOCS_PAGES.get('design-decisions.md') ?? '';
const SCALING_PAGE = DOCS_PAGES.get('physical-values.md') ?? '';

const WORDS: Readonly<Record<string, number>> = {
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
};

describe('the number of ways a scale is refused', () => {
  it('is written as a word on the decision record, with the fifth called out separately', () => {
    const stated = /(\w+) header conditions make a linear conversion impossible or wrong/.exec(
      DECISIONS,
    );
    expect(stated?.[1], 'design-decisions.md no longer counts the header conditions').toBeDefined();
    expect(WORDS[stated?.[1] as string]).toBe(4);
    // The fifth is named, and named as derived rather than declared — which is why it is not one
    // of the four.
    expect(DECISIONS.replace(/\s+/g, ' ')).toContain(
      'A fifth condition catches a derived gain that is not a usable float64 number',
    );
  });

  it('is the same total the scaling page tabulates', () => {
    const stated = /(\w+) conditions produce it, checked in this order/.exec(SCALING_PAGE);
    expect(stated?.[1], 'physical-values.md no longer counts them').toBeDefined();
    expect(WORDS[stated?.[1] as string]).toBe(5);
    // Four declared plus the one derived. Written as the sum so that changing either page alone
    // fails rather than leaving two pages quietly disagreeing about one number.
    expect(4 + 1).toBe(WORDS[stated?.[1] as string]);
  });

  it('is the number of places buildScale abandons a scale', () => {
    const source = readFileSync(new URL('../../src/header/scale.ts', import.meta.url), 'utf8');
    // Every refusal ends the same way: report the diagnostic, then abandon the scale.
    const refusals = source.match(/\n {4}\);\n {4}return undefined;\n/g) ?? [];
    expect(refusals).toHaveLength(5);
  });

  it('names the four declared ones in the words the fields use', () => {
    // The four are identified by the field comparison a reader can make by eye, so a page that
    // renamed one into something the header does not say would stop being usable as a checklist.
    const flat = DECISIONS.replace(/\s+/g, ' ');
    for (const named of [
      '`digitalMinimum === digitalMaximum`',
      'a degenerate physical range',
      'an inverted digital range',
      'physical dimension is exactly `Filtered`',
    ]) {
      expect(flat, named).toContain(named);
    }
  });
});
