/**
 * The fifteenth shape: a file with two annotation channels.
 *
 * EDF+ permits more than one, and the specification is specific about the asymmetry between them:
 * the FIRST annotations signal carries the timekeeping TAL that states each record's onset, and any
 * of them may carry events. Two scorers writing into one file, or a device that separates its own
 * markers from a technician's notes, produce exactly this.
 *
 * `secondary-annotation-signal.test.ts` covers the decoding. What the matrix had never held is a
 * file where the answer to "the annotations channel" is two channels of different widths — so a
 * helper that finds one and stops loses half the events silently, and a fixed stride through the
 * record is wrong for one of them. That is the failure a sweep over a whole file can see and a
 * targeted test cannot: `readAnnotations` with no `signalIndices` has to reach both.
 *
 * Every sweep passes over it. This file pins what makes it that shape, and the one property the
 * sweeps do not state: both scorers' events come back from one call, in onset order.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';

const SHAPE = AWKWARD.find((file) => file.name === 'two annotation signals');

async function shape() {
  if (SHAPE === undefined) throw new Error('the matrix lost the two-channel shape');
  return openEdf(byteSource(SHAPE.bytes));
}

describe('the shape', () => {
  it('is in the matrix, which is fifteen shapes', () => {
    expect(SHAPE).toBeDefined();
    expect(AWKWARD).toHaveLength(15);
  });

  it('really has two annotation channels, of different widths', async () => {
    const { header } = await shape();
    expect(header.annotationSignalIndices).toHaveLength(2);
    const widths = [...header.annotationSignalIndices].map(
      (index) => header.signals[index]?.samplesPerRecord,
    );
    expect(new Set(widths).size).toBe(2);
  });

  it('is the only shape in the matrix with more than one', async () => {
    const counts: number[] = [];
    for (const file of AWKWARD) {
      const { header } = await openEdf(byteSource(file.bytes));
      counts.push(header.annotationSignalIndices.length);
    }
    expect(counts.filter((count) => count > 1)).toHaveLength(1);
  });
});

describe('reading it', () => {
  it('returns both scorers from one call, without being asked for either', async () => {
    const recording = await shape();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const texts = annotations.map((one) => one.text);
    expect(texts).toContain('scored by A');
    expect(texts).toContain('scored by B');
  });

  it('sorts them together, rather than one channel after the other', async () => {
    const recording = await shape();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const onsets = annotations.map((one) => one.onsetTicksFromFirstRecord);
    expect([...onsets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(onsets);
  });

  it('says which channel each came from, so a caller can tell the scorers apart', async () => {
    const recording = await shape();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const a = annotations.find((one) => one.text === 'scored by A');
    const b = annotations.find((one) => one.text === 'scored by B');
    expect(a?.signalIndex).not.toBe(b?.signalIndex);
    expect([...recording.header.annotationSignalIndices]).toContain(a?.signalIndex);
    expect([...recording.header.annotationSignalIndices]).toContain(b?.signalIndex);
  });

  it('reads one channel alone when asked, which is what makes the default worth checking', async () => {
    const recording = await shape();
    const [first] = recording.header.annotationSignalIndices;
    if (first === undefined) throw new Error('no annotation channel');
    const { annotations } = await readAnnotations(
      recording,
      { start: 0, count: 4 },
      { signalIndices: [first] },
    );
    expect(annotations.map((one) => one.text)).toEqual(['scored by A']);
  });
});
