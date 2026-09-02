/**
 * `spanSeconds - coveredSeconds` is a signed number, and `discontinuous.md` read it as unsigned.
 *
 * The page said: "when they differ, the difference is time that sits inside the recording and that
 * no record covers". That is one of the two ways they can differ. `coveredSeconds` is the sum of
 * the record durations and nothing subtracts a double-counted second from it, so on a file whose
 * records overlap it exceeds the span outright — six seconds of coverage inside a three-and-a-half
 * second recording — and the difference is not uncovered time but time two records both claim.
 *
 * The library never believed the unsigned reading. `resolveTimeWindow` partitions exactly this
 * comparison by sign and has since 0.3.33, because the one-sided message was arithmetic nonsense
 * on an overlapping file: "span 3.5 s but cover only 4 s" says "only" of the larger number.
 * `edfcore gaps` counts holes and overlaps apart (0.3.3), `EdfGap.durationSeconds` goes negative
 * for one (0.2.69), and `DISCONTINUITY_IN_CONTINUOUS_FILE` names them separately. The page was the
 * last place the difference had one meaning.
 *
 * Twenty-five lines below the sentence, the same page already said a gap and an overlap can cancel
 * at the two probes. It knew overlaps existed where it described what the probes cannot see, and
 * not where it described what they measure.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('discontinuous.md') ?? '';

const shape = (name: string): Uint8Array => {
  const found = AWKWARD.find((file) => file.name === name);
  if (found === undefined) throw new Error(`no shape named ${name}`);
  return found.bytes;
};

describe('the page', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(PAGE).toContain('spanSeconds');
    expect(PAGE.length).toBeGreaterThan(1000);
  });

  it('no longer says the difference is uncovered time full stop', () => {
    expect(PAGE).not.toContain(
      'When they differ, the difference is time that sits inside the recording',
    );
  });

  it('names the sign, and names the overlap the negative one means', () => {
    expect(PAGE).toContain('spanSeconds - coveredSeconds');
    expect(PAGE).toMatch(/Negative means\s+records OVERLAP/);
  });
});

describe('the shape that makes the old sentence false', () => {
  const bytes = shape('records that overlap in time');

  it('covers more seconds than it spans', async () => {
    const { timeline } = await openEdf(byteSource(bytes));
    expect(timeline.spanSeconds).toBe(3.5);
    expect(timeline.coveredSeconds).toBe(6);
    // The difference the page called "time no record covers" is negative here.
    expect(timeline.spanSeconds - timeline.coveredSeconds).toBeLessThan(0);
  });

  it('has no gaps at all, so the difference is not a hole under another name', async () => {
    const { timeline } = await openEdf(byteSource(bytes));
    expect(timeline.coveredTicks).toBeGreaterThan(timeline.spanTicks);
  });

  it('is refused with the sentence the page now quotes, not with a gap', async () => {
    const recording = await openEdf(byteSource(bytes));
    const refusal = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 2,
      signalIndices: [0],
    }).then(
      () => 'it returned',
      (error: unknown) => (error as Error).message,
    );
    const quoted =
      'records covering 6 s are packed into a 3.5 s span, so at least one record starts ' +
      'before the previous one ends';
    expect(refusal).toContain(quoted);
    expect(refusal).not.toContain('so it contains at least one gap');
    // The page quotes it verbatim, so the quote cannot drift away from the message.
    expect(PAGE).toContain('records covering 6 s are packed into a 3.5 s span');
  });
});

describe('the shape the old sentence was written for', () => {
  const bytes = shape('EDF+D with a gap');

  it('spans more seconds than it covers, which is the positive difference', async () => {
    const { timeline } = await openEdf(byteSource(bytes));
    expect(timeline.spanSeconds).toBeGreaterThan(timeline.coveredSeconds);
  });
});

describe('across the matrix', () => {
  it('is the seventeen shapes', () => {
    expect(AWKWARD).toHaveLength(17);
  });

  it('produces both signs and a zero, so neither reading covers it alone', async () => {
    const differences = await Promise.all(
      AWKWARD.map(async (file) => {
        const { timeline } = await openEdf(byteSource(file.bytes));
        return timeline.spanSeconds - timeline.coveredSeconds;
      }),
    );
    expect(differences.some((one) => one > 0)).toBe(true);
    expect(differences.some((one) => one < 0)).toBe(true);
    expect(differences.some((one) => one === 0)).toBe(true);
  });
});
