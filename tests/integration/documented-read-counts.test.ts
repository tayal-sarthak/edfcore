/**
 * The read counts `api-reading.md` states are the reads `openEdf` issues.
 *
 * "On a plain EDF or BDF it costs two reads. On a file that carries an annotations signal it costs
 * four. A single-record file is probed once, for three reads total; a file with no data records is
 * not probed at all." That paragraph is the random-access claim in miniature, and it is the number
 * a reader budgets an HTTP round trip against.
 *
 * `read-pattern.test.ts` already pins these counts — against literals it holds itself. The page
 * holds its own, and nothing compared them, which is the shape 0.4.267 found in the CLI column
 * table and 0.4.280 in the exit codes: one contract, two statements, kept in step by hand.
 *
 * So the expectation is parsed out of the sentence and each case is driven through a counting
 * source. The numbers are spelled out in the prose, which is right for prose, so they are read
 * through a word list — the same treatment `tests/README.md`'s fixture counts get.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-reading.md') ?? '';

const WORDS: ReadonlyMap<string, number> = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
]);

/** The sentence's own numbers, so the page is the expectation. */
const CLAIMED = (() => {
  const flat = PAGE.replace(/\s+/g, ' ');
  const number = (pattern: RegExp): number | undefined => {
    const word = pattern.exec(flat)?.[1];
    return word === undefined ? undefined : WORDS.get(word);
  };
  return {
    plain: number(/it costs \*\*(\w+) reads\*\*/),
    annotations: number(/annotations signal it costs \*\*(\w+)\*\*/),
    singleRecord: number(/probed once, for (\w+) reads total/),
  };
})();

/** How many reads opening these bytes takes. */
async function readsToOpen(bytes: Uint8Array): Promise<number> {
  const spy = spySource(byteSource(bytes));
  await openEdf(spy);
  return spy.reads.length;
}

describe('the sentence was parsed', () => {
  it('found all three numbers, so a passing run is not a vacuous one', () => {
    expect(CLAIMED.plain, 'no "it costs **two reads**" on api-reading.md').toBeDefined();
    expect(CLAIMED.annotations).toBeDefined();
    expect(CLAIMED.singleRecord).toBeDefined();
  });

  it('states counts that differ, so one number cannot satisfy all three', () => {
    expect(new Set(Object.values(CLAIMED)).size).toBe(3);
  });
});

describe('opening a file costs what the page says', () => {
  it('a plain EDF: the two header reads and no probe', async () => {
    const plain = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
    });
    expect(await readsToOpen(plain)).toBe(CLAIMED.plain);
  });

  it('an EDF+ with annotations: the header, plus a record at each end', async () => {
    const annotated = minimalEdfPlus({ recordCount: 6, recordDurationSeconds: 1 });
    expect(await readsToOpen(annotated)).toBe(CLAIMED.annotations);
  });

  it('a single-record EDF+: probed once, because both ends are the same record', async () => {
    const single = minimalEdfPlus({ recordCount: 1, recordDurationSeconds: 1 });
    expect(await readsToOpen(single)).toBe(CLAIMED.singleRecord);
  });

  it('an EDF+ with no data records: not probed at all', async () => {
    // The page says so without a number, so the claim is that it costs the plain count.
    const empty = minimalEdfPlus({ recordCount: 0, recordDurationSeconds: 1 });
    expect(await readsToOpen(empty)).toBe(CLAIMED.plain);
  });
});
