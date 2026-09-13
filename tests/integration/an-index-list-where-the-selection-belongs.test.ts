/**
 * The signal indices passed as the selection.
 *
 * 0.6.79 gave these calls a shared check on the selection argument, because without it each of
 * them named "whichever field it happened to read first". The check is `typeof selection ===
 * 'object'`, and an array is an object — so an array walked past it and reproduced the exact
 * failure that release removed.
 *
 * `readWindow(recording, [0])` is the mistake. `signalIndices` is the one argument several of
 * these calls need at all, `[0]` is the shortest thing that expresses it, and passing it directly
 * reads as correct at the call site.
 *
 * Each entry point then blamed something different:
 *
 *   - `readWindow`, `readRecords` and `streamRecords` blamed `signalIndices` for being missing;
 *   - `readEnvelope` blamed `buckets`;
 *   - `readEnvelopeAtResolution` blamed `secondsPerBucket`;
 *   - `readTriggers` blamed the FILE, for having no BioSemi Status channel.
 *
 * The first is the worst, because it is the one a caller acts on: "signalIndices is missing, not
 * an array of signal indices ... Next: pass header.dataSignalIndices for all of the data signals,
 * or an array of the indices you want". An array of the indices they wanted is precisely what they
 * passed, so the advice describes what they had already done.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** BDF with a Status channel, so `readTriggers` reaches its selection instead of refusing the file. */
const FILE = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    {
      label: 'Status',
      samplesPerRecord: 8,
      physicalMinimum: -8388608,
      physicalMaximum: 8388607,
      digitalMinimum: -8388608,
      digitalMaximum: 8388607,
    },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

type Call = (recording: EdfRecording, selection: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  ['readWindow', (recording, selection) => readWindow(recording, selection as never)],
  ['readRecords', (recording, selection) => readRecords(recording, selection as never)],
  [
    'streamRecords',
    async (recording, selection) => {
      for await (const chunk of streamRecords(recording, selection as never)) return chunk;
      return undefined;
    },
  ],
  ['readEnvelope', (recording, selection) => readEnvelope(recording, selection as never)],
  [
    'readEnvelopeAtResolution',
    (recording, selection) => readEnvelopeAtResolution(recording, selection as never),
  ],
  ['readTriggers', (recording, selection) => readTriggers(recording, selection as never)],
];

describe.each(CALLS)('%s, given the signal indices as the selection', (_name, call) => {
  const refusal = async (selection: unknown): Promise<string> => {
    const recording = await opened();
    try {
      await call(recording, selection);
    } catch (error) {
      return (error as Error).message;
    }
    return '';
  };

  it('says the selection is an array and where signalIndices belongs', async () => {
    const message = await refusal([0]);
    expect(message).toContain('the selection is an array');
    expect(message).toContain('signalIndices is a field on the selection');
  });

  it('names the shape this particular call takes', async () => {
    expect(await refusal([0])).toMatch(/Next: pass \{/);
  });

  it('no longer blames a field the caller never wrote', async () => {
    const message = await refusal([0]);
    expect(message).not.toContain('signalIndices is missing');
    expect(message).not.toContain('buckets must be');
    expect(message).not.toContain('secondsPerBucket must be');
    expect(message).not.toContain('no BioSemi Status channel');
  });

  it('answers an empty array the same way, rather than by a second route', async () => {
    expect(await refusal([])).toContain('the selection is an array');
  });
});

describe('the selections these calls do take', () => {
  it('still reads a window', async () => {
    const chunks = await readWindow(await opened(), {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    expect(chunks[0]?.signals[0]?.sampleCount).toBe(16);
  });

  it('still names a records range handed to a window call', async () => {
    await expect(
      readWindow(await opened(), { records: { start: 0, count: 1 }, signalIndices: [0] } as never),
    ).rejects.toThrow(/takes a time window/);
  });

  it('still refuses a selection that is not an object at all', async () => {
    await expect(readWindow(await opened(), 'everything' as never)).rejects.toThrow(
      /the selection is a string, not an object/,
    );
  });
});
