/**
 * `resolveTimeWindow` given the header where the timeline belongs.
 *
 * The header carries `recordCount` and `recordDurationTicks` under the same names with the same
 * meanings, so every branch of this function ran on one — except the branch that needs `spanTicks`
 * and `coveredTicks`, which are the timeline's alone. `undefined !== undefined` is false, so the
 * discontinuity check did not fire.
 *
 * A window over an EDF+D file with a five-second hole then came back as `[{ start: 0, count: 4 }]`:
 * every record, mapped onto the nominal grid, as if the file were continuous. The correct call
 * throws, because "the records a window maps to depend on onsets nobody has read, and this function
 * refuses rather than guessing them."
 *
 * So the one failure this function exists to prevent was reachable by passing the wrong first
 * argument, and it was silent (fixed in 0.6.123).
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../../src/io/bytes.js';
import { buildRecordIndex } from '../../../src/record-index.js';
import { openEdf } from '../../../src/recording.js';
import { resolveTimeWindow } from '../../../src/time/window.js';
import type { EdfRecordIndex, EdfTimeline } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

/** Records 0 and 1 at t = 0 and 1 s; records 2 and 3 at 7 s and 8 s. A five-second hole. */
const GAPPY = buildEdf({
  plus: 'D',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 5),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = () => openEdf(byteSource(GAPPY));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  const outcome = (() => {
    try {
      return { ok: true as const, value: run() };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();
  if (outcome.ok) throw new Error(`accepted, and returned ${JSON.stringify(outcome.value)}`);
  return outcome.message;
}

describe('the header, which carries two of the three fields this reads', () => {
  it('no longer maps a window onto a file whose gap nobody has seen', async () => {
    const recording = await opened();
    const message = refusal(() =>
      resolveTimeWindow(loosely<EdfTimeline>(recording.header), recording.index, 0, 10),
    );
    expect(message).toContain('resolveTimeWindow(): that is not a timeline');
    expect(message).toContain('it has no spanTicks');
  });

  it('says which check the missing field is the one for', async () => {
    const recording = await opened();
    expect(
      refusal(() =>
        resolveTimeWindow(loosely<EdfTimeline>(recording.header), recording.index, 0, 10),
      ),
    ).toContain('refuses to map a window onto a file with an unseen gap');
  });

  it('is the answer the correct call refuses to give', async () => {
    const recording = await opened();
    // What the correct call does, and what the header call used to do instead.
    expect(() => resolveTimeWindow(recording.timeline, recording.index, 0, 10)).toThrow(
      /cannot be mapped from seconds to records/,
    );
    expect(() =>
      resolveTimeWindow(loosely<EdfTimeline>(recording.header), recording.index, 0, 10),
    ).toThrow(/not a timeline/);
  });
});

describe('the second argument', () => {
  it('is checked too, and named as the second', async () => {
    const recording = await opened();
    expect(
      refusal(() =>
        resolveTimeWindow(recording.timeline, loosely<EdfRecordIndex>(recording), 0, 10),
      ),
    ).toContain('the second argument is not a record index');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    expect(
      refusal(() => resolveTimeWindow(recording.timeline, loosely<EdfRecordIndex>(given), 0, 10)),
    ).toContain('not a record index');
  });
});

describe('the calls that are right', () => {
  it('still refuse a window a probed index cannot map', async () => {
    const recording = await opened();
    expect(refusal(() => resolveTimeWindow(recording.timeline, recording.index, 0, 10))).toContain(
      'span 9 s but cover only 4 s',
    );
  });

  it('still map the window once the index is complete, gap and all', async () => {
    const recording = await opened();
    const index = await buildRecordIndex(recording);
    expect(resolveTimeWindow(recording.timeline, index, 0, 10)).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 2 },
    ]);
  });
});
