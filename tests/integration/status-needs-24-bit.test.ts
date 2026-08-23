/**
 * A 16-bit channel labelled `Status` is not a BioSemi Status channel.
 *
 * `api-helpers.md` explains why `readTriggers` locates the channel itself instead of taking a
 * `signalIndices`: "a 24-bit EEG sample decoded as a trigger word yields plausible-looking events
 * out of ordinary data, so there is no way to point this call at the wrong channel." That
 * reasoning is about pointing at the wrong channel of the right file. The other way in is the
 * right channel NAME in the wrong kind of file.
 *
 * `Status` is not a BioSemi word. Plenty of systems label a channel that way, and a plain EDF file
 * carrying one is an ordinary thing to be handed. Its samples are 16 bits of a measurement; a
 * BioSemi Status word is 24 bits of a latched bit field, with the trigger input in the low 16 and
 * flags at bits 16, 20 and 22. Read one as the other and every sample looks like a trigger word:
 * the low bits become codes, bit 16 becomes an epoch marker that flips constantly, and what comes
 * back is a dense list of events with real timestamps, from a channel that recorded a voltage.
 * Nothing about that output says it is wrong.
 *
 * The guard is one line — the file's samples must be three bytes wide — and it is what makes the
 * documented `getStatusSignal(header) !== undefined` check mean "this is an ActiveTwo recording"
 * rather than "something here is called Status". It had never been given a 16-bit file to refuse.
 *
 * What this does NOT check: that a 24-bit file's Status channel really came from an ActiveTwo.
 * Nothing in the format says so, and edfcore does not guess — the width and the label are the
 * whole of what it will assert.
 */

import { describe, expect, it } from 'vitest';
import { getStatusSignal, readTriggers } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SAMPLES = 4;

/** The same two channels either way; only the sample width differs. */
const file = (format: 'EDF' | 'BDF', label: string): Uint8Array =>
  buildEdf({
    format,
    plus: false,
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: ['A1', label].map((name) => ({
      label: name,
      samplesPerRecord: SAMPLES,
      // A value with bits set across the trigger field and the flag bits, so a misread would
      // produce events rather than silence.
      sample: () => 0x4321,
    })),
  });

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe('the width the channel is stored at', () => {
  it('is what tells a Status channel from a channel called Status', async () => {
    const bdf = await open(file('BDF', 'Status'));
    const edf = await open(file('EDF', 'Status'));
    expect(bdf.header.bytesPerSample).toBe(3);
    expect(edf.header.bytesPerSample).toBe(2);

    expect(getStatusSignal(bdf.header)?.label.trim()).toBe('Status');
    expect(getStatusSignal(edf.header)).toBeUndefined();
  });

  it.each(['Status', 'STATUS', 'status ', ' Status'])(
    'refuses the label %p in a 16-bit file however it is written',
    async (label) => {
      const edf = await open(file('EDF', label));
      // The label matching is deliberately forgiving; the width is not.
      expect(getStatusSignal(edf.header)).toBeUndefined();
    },
  );

  it('makes the documented guard mean what the page says it means', async () => {
    // `if (getStatusSignal(recording.header) !== undefined)` is the page's own example, and it
    // has to answer "this is an ActiveTwo recording", not "something here is called Status".
    const edf = await open(file('EDF', 'Status'));
    expect(getStatusSignal(edf.header) !== undefined).toBe(false);
  });
});

describe('and the read that would have followed', () => {
  it('refuses the 16-bit file instead of returning plausible events', async () => {
    const edf = await open(file('EDF', 'Status'));
    const failure = await readTriggers(edf, { startSeconds: 0, durationSeconds: 2 }).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    );
    expect(failure, 'readTriggers accepted a 16-bit file').toBeDefined();
    expect(failure?.message).toContain('Status');
    expect(failure?.message).toContain('Next:');
  });

  it('reads the 24-bit twin, so the refusal is about the width and not the fixture', async () => {
    const bdf = await open(file('BDF', 'Status'));
    const events = await readTriggers(bdf, { startSeconds: 0, durationSeconds: 2 });
    // One held code across the whole file: one event at the start, and no release, because it
    // never returns to zero.
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.trigger).toBe(0x4321);
  });
});
