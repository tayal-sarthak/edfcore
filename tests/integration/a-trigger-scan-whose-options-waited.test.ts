/**
 * `readTriggers`, given its options as a bare value or as an AbortSignal.
 *
 * 0.6.155 and 0.6.166 taught `assertReadOptions` both shapes, and 0.6.169 made the argument for
 * checking them at the CALL rather than at the first read: the guard lives inside the read, so a
 * window that resolves to no records — past the end, inside an EDF+D gap, of zero duration — never
 * reaches it, and whether a mistake is refused depends on the data instead of on the call.
 *
 * `readTriggers` is the last read in the package that deferred it, and the one where it costs most.
 * `[]` is one of its real answers: "no trigger changed in this window" is what an experimenter reads
 * off an empty result, and this is the path whose own docblocks say twice that a missing event is
 * indistinguishable from no events. So `readTriggers(recording, window, controller.signal)` over a
 * window with nothing in it resolved empty, with the cancellation dropped, and the same call over a
 * window with records in it was refused all along.
 *
 * A byte count is the likelier spelling of the bare form here — `maxMaterializeBytes` is what sizes
 * this scan's chunks, through `scanChunkRecords`, so it is the option a caller of this function has
 * a number for.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording, TriggerSelection } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 4;

const FILE = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

/** Windows that resolve to no records at all, which is where the deferred guard never ran. */
const EMPTY_WINDOWS: ReadonlyArray<readonly [string, TriggerSelection]> = [
  ['past the end of the recording', { startSeconds: 100, durationSeconds: 4 }],
  ['of zero duration', { startSeconds: 0, durationSeconds: 0 }],
  ['before the recording starts', { startSeconds: -10, durationSeconds: 5 }],
];

const BARE: ReadonlyArray<readonly [string, unknown]> = [
  ['a byte count, meant as maxMaterializeBytes', 64 * 1024 * 1024],
  ['a boolean', true],
  ['a string', '64MB'],
];

describe.each(EMPTY_WINDOWS)('a window %s', (_shape, selection) => {
  it.each(BARE)('refuses %s rather than resolving empty', async (_name, options) => {
    const recording = await opened();
    const thrown = await readTriggers(recording, selection, options as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the scan resolved with the options dropped').toBeDefined();
    expect(thrown?.message).toContain('maxMaterializeBytes and signal are fields on one');
  });

  it('refuses an AbortSignal handed over in place of the options', async () => {
    const recording = await opened();
    const thrown = await readTriggers(
      recording,
      selection,
      new AbortController().signal as never,
    ).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    // The empty result and a cancelled scan look exactly alike from outside.
    expect(thrown, 'the cancellation was dropped and [] was returned').toBeDefined();
    expect(thrown?.message).toContain('signal is a field on');
  });

  it('still answers with no events when the options are right', async () => {
    const recording = await opened();
    await expect(readTriggers(recording, selection)).resolves.toEqual([]);
    await expect(
      readTriggers(recording, selection, { maxMaterializeBytes: 1024 * 1024 }),
    ).resolves.toEqual([]);
  });
});

describe('a window with records in it', () => {
  const selection: TriggerSelection = { startSeconds: 0, durationSeconds: RECORDS };

  it('refuses the same shapes it always did', async () => {
    const recording = await opened();
    await expect(readTriggers(recording, selection, (64 * 1024 * 1024) as never)).rejects.toThrow(
      /maxMaterializeBytes and signal are fields on one/,
    );
    await expect(
      readTriggers(recording, selection, new AbortController().signal as never),
    ).rejects.toThrow(/signal is a field on/);
  });

  it('still reports the triggers it finds', async () => {
    const recording = await opened();
    const events = await readTriggers(recording, selection);
    expect(events.length).toBeGreaterThan(0);
    expect(typeof events[0]?.trigger).toBe('number');
  });
});
