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
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, contiguityOf } from '../../src/record-index.js';
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
