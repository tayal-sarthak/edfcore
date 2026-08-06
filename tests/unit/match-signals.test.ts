/**
 * matchSignals.
 *
 * The one behaviour worth pinning: an annotations channel is never returned. A pattern like
 * /EDF|EEG/ would otherwise pick it up, and its bytes are TAL text, so decoding them as samples
 * produces numbers that look exactly like a signal.
 */

import { describe, expect, it } from 'vitest';
import { matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

async function header() {
  const recording = await openEdf(
    byteSource(
      minimalEdfPlus({
        recordCount: 2,
        signals: [
          { label: 'EEG Fpz-Cz', samplesPerRecord: 4 },
          { label: 'EEG Pz-Oz', samplesPerRecord: 4 },
          { label: 'Temp rectal', samplesPerRecord: 4 },
        ],
      }),
    ),
  );
  return recording.header;
}

/** A header with exactly the signals given, plus the EDF+ annotations channel. */
async function headerOf(signals: ReadonlyArray<{ label: string; samplesPerRecord: number }>) {
  const recording = await openEdf(
    byteSource(minimalEdfPlus({ recordCount: 2, signals: [...signals] })),
  );
  return recording.header;
}

describe('matchSignals', () => {
  it('returns a family by pattern', async () => {
    expect((await header()).signals.length).toBeGreaterThan(3);
    expect(matchSignals(await header(), /^EEG /).map((s) => s.label)).toEqual([
      'EEG Fpz-Cz',
      'EEG Pz-Oz',
    ]);
  });

  it('accepts a predicate', async () => {
    expect(matchSignals(await header(), (l) => l.includes('rectal')).map((s) => s.label)).toEqual([
      'Temp rectal',
    ]);
  });

  it('never returns an annotations channel, however broad the pattern', async () => {
    const h = await header();
    expect(h.annotationSignalIndices.length).toBeGreaterThan(0);
    const all = matchSignals(h, /.*/);
    expect(all.every((s) => s.kind === 'data')).toBe(true);
    expect(all).toHaveLength(h.dataSignalIndices.length);
  });

  it('returns an empty list rather than throwing when nothing matches', async () => {
    expect(matchSignals(await header(), /nothing/)).toEqual([]);
  });
});

describe('a regex with a global or sticky flag', () => {
  // `RegExp.prototype.test` starts from `lastIndex` and advances it when the pattern carries `g`
  // or `y`. Used across an array that makes each element's answer depend on the previous one, so
  // before 0.2.21 a `/g` pattern returned roughly half its true matches — silently.
  it('matches exactly what the same pattern without the flag matches', async () => {
    const header = await headerOf([
      { label: 'EEG Fpz-Cz', samplesPerRecord: 4 },
      { label: 'EEG Pz-Oz', samplesPerRecord: 4 },
      { label: 'EOG horizontal', samplesPerRecord: 4 },
      { label: 'EEG C3-A2', samplesPerRecord: 4 },
      { label: 'EEG O1-A2', samplesPerRecord: 4 },
    ]);

    const plain = matchSignals(header, /^EEG/).map((s) => s.label);
    expect(plain).toEqual(['EEG Fpz-Cz', 'EEG Pz-Oz', 'EEG C3-A2', 'EEG O1-A2']);
    expect(matchSignals(header, /^EEG/g).map((s) => s.label)).toEqual(plain);
    expect(matchSignals(header, /^EEG/y).map((s) => s.label)).toEqual(plain);
  });

  it('keeps the match-everything invariant that the flagless form has', async () => {
    // `matchSignals(header, /.*/)` returning every data signal is the pinned invariant above.
    // One flag character used to break it.
    const header = await headerOf([
      { label: 'A1', samplesPerRecord: 2 },
      { label: 'A2', samplesPerRecord: 2 },
      { label: 'A3', samplesPerRecord: 2 },
      { label: 'A4', samplesPerRecord: 2 },
    ]);
    expect(matchSignals(header, /.*/g)).toHaveLength(4);
  });

  it('returns the same answer every time it is called with one regex object', async () => {
    // The defect was also non-idempotent: the second call started wherever the first stopped.
    const header = await headerOf([
      { label: 'EEG a', samplesPerRecord: 2 },
      { label: 'EEG b', samplesPerRecord: 2 },
      { label: 'EEG c', samplesPerRecord: 2 },
    ]);
    const shared = /EEG/g;
    const first = matchSignals(header, shared).map((s) => s.label);
    expect(matchSignals(header, shared).map((s) => s.label)).toEqual(first);
    expect(matchSignals(header, shared).map((s) => s.label)).toEqual(first);
    expect(first).toHaveLength(3);
  });

  it('does not mutate the caller regex', async () => {
    // Cloning rather than resetting: a module-level `const P = /x/g` shared with a String.replace
    // elsewhere must not behave differently because edfcore was called first.
    const header = await headerOf([{ label: 'EEG a', samplesPerRecord: 2 }]);
    const shared = /EEG/g;
    shared.lastIndex = 2;
    matchSignals(header, shared);
    expect(shared.lastIndex).toBe(2);
  });
});
