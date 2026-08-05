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
