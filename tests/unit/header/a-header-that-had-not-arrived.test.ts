/**
 * The three lookups given what `readHeader` returns, without awaiting it.
 *
 * Their shared guard's next step names `parseHeader`, which is synchronous. The call a reader
 * reaches for when they have a SOURCE rather than bytes is `readHeader`, and that one is async — so
 * `getSignal(readHeader(source), 'Fp1')` is one keyword short, and the whole of what it was told is
 * that the argument has no signals. True of a pending Promise, and true of almost everything else,
 * so it named nothing a reader could act on.
 *
 * 0.6.89 made this argument for the recording — a message that names a field rather than the
 * argument says "nothing about the one keyword that fixes it" — and 0.6.214 taught `describeValue`
 * to say it, which covers every message that reads its subject out of that helper. This guard names
 * its subject in fixed text, and it stands in front of three of the five published lookups.
 */

import { describe, expect, it } from 'vitest';
import { findSignals, getSignal, matchSignals } from '../../../src/header/lookup.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readHeader } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EEG Pz-Oz', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const CALLS: ReadonlyArray<readonly [string, (header: unknown) => unknown]> = [
  ['getSignal', (header) => getSignal(header as never, 0)],
  ['findSignals', (header) => findSignals(header as never, 'EEG Fpz-Cz')],
  ['matchSignals', (header) => matchSignals(header as never, /EEG/)],
];

describe.each(CALLS)('%s', (_name, call) => {
  it('names the keyword for a header that had not arrived', async () => {
    const pending = readHeader(byteSource(FILE));
    let thrown: Error | undefined;
    try {
      call(pending);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('a pending Promise, not a header');
    expect(thrown?.message).toContain('await readHeader(source)');
    expect(thrown?.message).not.toContain('it has no signals');
    await pending;
  });

  it('still answers once it has arrived', async () => {
    const header = await readHeader(byteSource(FILE));
    expect(call(header)).toBeDefined();
  });

  it('keeps the 0.6.127 refusal for something that is simply not a header', async () => {
    const recording = await openEdf(byteSource(FILE));
    let thrown: Error | undefined;
    try {
      call(recording);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('it has no signals');
    expect(thrown?.message).toContain('parseHeader(bytes, sourceByteLength)');
  });

  it('keeps the 0.6.183 refusal for a chunk, which has a signals array', async () => {
    const recording = await openEdf(byteSource(FILE));
    const chunks = await (await import('../../../src/recording.js')).readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    expect(() => call(chunks[0])).toThrow(/that is a chunk, not a header/);
  });
});
