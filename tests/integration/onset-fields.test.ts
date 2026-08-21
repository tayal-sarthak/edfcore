/**
 * The four onset fields, tabulated twice, and the "exact" column that is a claim about arithmetic.
 *
 * `annotations.md` lists them with the axis each is measured from and whether it is exact;
 * `api-helpers.md` lists the same four under "Which onset field to compare". Two tables of one
 * fact, which is the shape this repository keeps finding wrong.
 *
 * The tables also make a claim that can be executed rather than compared: two of the four are
 * exact and two are not. That is not a statement about precision in the abstract — it is why
 * `filterAnnotationsByTime` compares ticks, and why comparing the seconds fields "goes wrong in
 * one specific way: the obvious filter compares `onsetSecondsFromFirstRecord`, which is float64
 * seconds divided out of an exact tick count, so an onset and a bound that should be equal need
 * not compare equal".
 *
 * So the exactness column is checked by finding an onset where the float and the tick disagree.
 * Both tables also give a worked example whose values are pinned, and the pair differs by exactly
 * `timeline.startOffsetSeconds`, which is the whole reason there are two axes at all.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const ANNOTATIONS = DOCS_PAGES.get('annotations.md') ?? '';
const HELPERS = DOCS_PAGES.get('api-helpers.md') ?? '';

/** Rows of a table, as the cells of each line after the header and separator. */
function rowsUnder(page: string, heading: string): readonly (readonly string[])[] {
  const at = page.indexOf(heading);
  if (at === -1) throw new Error(`no table ${JSON.stringify(heading)}`);
  const rows: string[][] = [];
  for (const line of page.slice(at).split('\n')) {
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim().replaceAll('`', '')),
    );
  }
  return rows.slice(2);
}

const FROM_ANNOTATIONS = rowsUnder(
  ANNOTATIONS,
  '| field | measured from | exact | value in the example below |',
);
const FROM_HELPERS = rowsUnder(HELPERS, '| Field | Axis | Exact |');

/** The example the annotations page builds: record 0 starting a quarter second in. */
const START_OFFSET = 0.25;

const built = async (onsetSeconds: number | string) => {
  const bytes = minimalEdfPlus({
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 60,
        tals: (record) => (record === 1 ? [{ onset: onsetSeconds, texts: ['Event'] }] : []),
      },
    ],
    recordOnsetSeconds: (record) => START_OFFSET + record,
  });
  const recording = await openEdf(byteSource(bytes));
  const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
  const event = annotations.find((entry) => entry.text === 'Event');
  if (event === undefined) throw new Error('fixture lost its annotation');
  return { recording, event };
};

describe('the two tables of the same four fields', () => {
  it('list the same four, in the same order', () => {
    expect(FROM_ANNOTATIONS).toHaveLength(4);
    expect(FROM_HELPERS).toHaveLength(4);
    // The order differs by design — one groups by axis, the other by exactness — so the sets are
    // what must agree.
    expect(new Set(FROM_ANNOTATIONS.map((row) => row[0]))).toEqual(
      new Set(FROM_HELPERS.map((row) => row[0])),
    );
  });

  it('agree about which axis each is measured from', () => {
    const axisOf = (cell: string): string => (/record 0/.test(cell) ? 'record 0' : 'header start');
    const fromAnnotations = new Map(
      FROM_ANNOTATIONS.map((row) => [row[0] ?? '', axisOf(row[1] ?? '')]),
    );
    for (const row of FROM_HELPERS) {
      expect(axisOf(row[1] ?? ''), row[0]).toBe(fromAnnotations.get(row[0] ?? ''));
    }
  });

  it('agree about which two are exact', () => {
    const exactIn = (rows: readonly (readonly string[])[], column: number): ReadonlySet<string> =>
      new Set(
        rows.filter((row) => (row[column] ?? '').startsWith('yes')).map((row) => row[0] ?? ''),
      );
    const fromAnnotations = exactIn(FROM_ANNOTATIONS, 2);
    const fromHelpers = exactIn(FROM_HELPERS, 2);
    expect(fromAnnotations).toEqual(fromHelpers);
    expect([...fromAnnotations].sort()).toEqual(['onsetTicks', 'onsetTicksFromFirstRecord']);
  });
});

describe('the exactness column, executed', () => {
  it('produces the four values the example prints', async () => {
    // `1.25`, `1`, `12500000n`, `10000000n` for an onset a quarter second after record 0's start.
    const expected = new Map(FROM_ANNOTATIONS.map((row) => [row[0] ?? '', row[3] ?? '']));
    const { event, recording } = await built(1.25);
    expect(recording.timeline.startOffsetSeconds).toBe(START_OFFSET);
    expect(String(event.onsetSecondsFromHeaderStart)).toBe(
      expected.get('onsetSecondsFromHeaderStart'),
    );
    expect(String(event.onsetSecondsFromFirstRecord)).toBe(
      expected.get('onsetSecondsFromFirstRecord'),
    );
    expect(`${event.onsetTicks}n`).toBe(expected.get('onsetTicks'));
    expect(`${event.onsetTicksFromFirstRecord}n`).toBe(expected.get('onsetTicksFromFirstRecord'));
  });

  it('separates the two axes by exactly the sub-second start offset', async () => {
    // "They differ by `recording.timeline.startOffsetSeconds`, which is record 0's timekeeping
    //  onset."
    const { event, recording } = await built(1.25);
    expect(Number(event.onsetTicks - event.onsetTicksFromFirstRecord) / 1e7).toBe(
      recording.timeline.startOffsetSeconds,
    );
  });

  it('keeps the tick fields exact where the seconds fields are not', async () => {
    // The failure the tables exist to prevent: an onset and a bound that should be equal, and are
    // not, once divided out into float64.
    // Written on the HEADER axis, so the offset is added back: these are 0.1 s and 0.3 s after
    // record 0 starts, which is the axis a window is measured on.
    const { event } = await built('0.35');
    const tripled = event.onsetTicksFromFirstRecord * 3n;
    const { event: three } = await built('0.55');
    expect(tripled).toBe(three.onsetTicksFromFirstRecord);
    expect(event.onsetSecondsFromFirstRecord * 3).not.toBe(three.onsetSecondsFromFirstRecord);
  });
});
