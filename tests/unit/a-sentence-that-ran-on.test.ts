/**
 * The one place `edfcore header` explains a discontinuous file, printed as a run-on.
 *
 * The note is three hand-wrapped `lines.push` calls that form a single sentence, and there was
 * nothing between the second and the third:
 *
 *     what the records cover, which on this file is not the span: its
 *     records may leave gaps between them, and may overlap each other
 *     buildRecordIndex(recording) reports the span and which it is
 *
 * Two independent clauses run together — and the break did more than look wrong. "which it is" is a
 * back-reference to the gaps-or-overlaps choice in the clause before it, and with no terminator
 * between them it reads as attaching to `buildRecordIndex(recording)` instead, which is not a thing
 * a span can be.
 *
 * This is the note a reader meets when `edfcore header` tells them their file is EDF+D, so it is the
 * sentence that has to survive being read once, quickly, in a terminal. `counted.ts` records what
 * this package thinks of that: the first line of `edfcore header` once read "1 signals", and "two
 * commands over one file disagreed about the same number".
 *
 * A terminator after "each other" and `which of the two` for the back-reference. The continuous-file
 * path prints none of this, which the last test pins (0.6.301).
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

const GAPPED = minimalEdfPlus({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (i: number) => (i < 3 ? i : i + 5),
} as never);

const CONTINUOUS = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 } as never);

const noteOf = async (bytes: Uint8Array): Promise<readonly string[]> => {
  const recording = await openEdf(byteSource(bytes));
  return formatHeader(recording.header)
    .split('\n')
    .filter((line) => /what the records cover|may leave gaps|buildRecordIndex/.test(line));
};

describe('the discontinuous note', () => {
  it('is the three wrapped lines of one sentence', async () => {
    const note = await noteOf(GAPPED);
    expect(note).toHaveLength(3);
    // All three continuation lines align under the value column, which is what makes them one note.
    for (const line of note) expect(line.startsWith('             ')).toBe(true);
  });

  it('closes the clause before the next one begins', async () => {
    const note = await noteOf(GAPPED);
    expect(note[1]?.trimEnd().endsWith('may overlap each other.')).toBe(true);
    expect(note[2]?.trimStart().startsWith('buildRecordIndex(recording)')).toBe(true);
  });

  it('no longer runs the two clauses together', async () => {
    const joined = (await noteOf(GAPPED)).map((line) => line.trim()).join(' ');
    expect(joined).not.toContain('each other buildRecordIndex');
    expect(joined).toContain('each other. buildRecordIndex(recording)');
  });

  it('points the back-reference at the two the sentence named', async () => {
    const joined = (await noteOf(GAPPED)).map((line) => line.trim()).join(' ');
    expect(joined).toContain('reports the span and which of the two.');
    // "which it is" had nothing to attach to across the break.
    expect(joined).not.toContain('which it is');
  });

  it('still says the three things it is there to say', async () => {
    const joined = (await noteOf(GAPPED)).map((line) => line.trim()).join(' ');
    expect(joined).toContain('what the records cover, which on this file is not the span');
    expect(joined).toContain('may leave gaps between them');
    expect(joined).toContain('may overlap each other');
    expect(joined).toContain('buildRecordIndex(recording)');
  });

  it('is printed for no continuous file, which is why it reads as a warning', async () => {
    expect(await noteOf(CONTINUOUS)).toEqual([]);
    const text = formatHeader((await openEdf(byteSource(CONTINUOUS))).header);
    expect(text).toContain('duration     00:00:04');
    expect(text).not.toContain('covered');
  });
});
