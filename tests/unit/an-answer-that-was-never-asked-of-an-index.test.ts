/**
 * `contiguityOf` given something that is not a record index.
 *
 * Three of this module's functions take the index and one of them has `'unknown'` among its real
 * answers, which is what makes a wrong argument dangerous here rather than merely unhelpful.
 * `contiguityOf(recording)` — the shape the name invites, since every other question a reader asks
 * is asked of the recording — read `recording.coverage`, found nothing, and returned `'unknown'`:
 * a valid answer, indistinguishable from a probed index, with nothing to tell the caller their
 * argument never reached the check at all (fixed in 0.6.91).
 *
 * `segmentAt` already makes this argument for its own `undefined`: returning it "would merge
 * 'there is a gap here' with 'nobody looked', which are the two answers a caller most needs to
 * keep apart." This is the same merge one level up.
 *
 * `segmentAt` and `gapAt` had it too, differently. They branch on the same `coverage` field and
 * refuse a PROBED index by name, so a wrong argument was told "this one is probed, so it has read
 * record 0 and the last record and nothing between" — a precise description of something the caller
 * never passed (fixed in 0.6.109).
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, contiguityOf, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecordIndex } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = () => openEdf(byteSource(FILE));

/** The cast a JavaScript caller does not need to write. */
const asIndex = (value: unknown) => value as EdfRecordIndex;

describe('a wrong argument cannot produce one of the three real answers', () => {
  it('refuses the recording rather than calling it "unknown"', async () => {
    const recording = await opened();
    expect(() => contiguityOf(asIndex(recording))).toThrow(RangeError);
    expect(() => contiguityOf(asIndex(recording))).toThrow(/not a record index/);
  });

  it('says why "unknown" is not available as a refusal, and what to pass', async () => {
    const recording = await opened();
    try {
      contiguityOf(asIndex(recording));
      expect.unreachable('the recording was accepted as an index');
    } catch (error) {
      const { message } = error as Error;
      expect(message).toContain('contiguityOf():');
      expect(message).toContain('it has no `coverage`');
      expect(message).toContain('Next: pass recording.index');
    }
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['the timeline', 'timeline'],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    const value = given === 'timeline' ? recording.timeline : given;
    expect(() => contiguityOf(asIndex(value))).toThrow(/not a record index/);
  });
});

describe('the two siblings that refuse a probed index by name', () => {
  it.each([
    ['segmentAt', segmentAt],
    ['gapAt', gapAt],
  ])('%s does not call a recording a probed index', async (name, call) => {
    const recording = await opened();
    try {
      call(asIndex(recording), 1);
      expect.unreachable('the recording was accepted as an index');
    } catch (error) {
      const { message } = error as Error;
      expect(message).toContain(`${name}(): that is not a record index`);
      expect(message).toContain('the probed-index refusal below it would describe something');
      expect(message).not.toContain('this one is probed');
    }
  });

  it.each([
    ['segmentAt', segmentAt],
    ['gapAt', gapAt],
  ])('%s still refuses a real probed index in its own words', async (_name, call) => {
    const recording = await opened();
    expect(() => call(recording.index, 1)).toThrow(/this one is probed/);
  });

  it.each([
    ['segmentAt', segmentAt],
    ['gapAt', gapAt],
  ])('%s still answers from a complete index', async (_name, call) => {
    const complete = await buildRecordIndex(await opened());
    expect(() => call(complete, 1)).not.toThrow();
  });
});

describe('the answers themselves are untouched', () => {
  it('still says unknown for the probed index the open produced', async () => {
    const recording = await opened();
    expect(contiguityOf(recording.index)).toBe('unknown');
  });

  it('still says contiguous for a complete index over a gapless file', async () => {
    const recording = await opened();
    expect(contiguityOf(await buildRecordIndex(recording))).toBe('contiguous');
  });
});
