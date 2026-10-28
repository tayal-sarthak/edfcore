/**
 * What a read RETURNS, handed to a read as what it TAKES.
 *
 * Re-reading a span with other signals is written by passing back the chunk that span came in, and
 * a chunk carries both a `records` range and a `startSeconds`. `assertSelection` names a records
 * range where a window belongs and a window where records belong, and a chunk is both, so neither
 * branch fired and each call refused it by the next field it happened to read: `readWindow` and its
 * siblings said "signalIndices is missing", `readEnvelope` asked for buckets — about an argument
 * that was never a selection at all.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

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

const refusal = async (call: Call, selection: (r: EdfRecording) => Promise<unknown>) => {
  const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
  try {
    await call(recording, await selection(recording));
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

const aChunk = async (recording: EdfRecording) => {
  const [chunk] = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
  });
  return chunk;
};

describe.each(CALLS)('%s, given a chunk as the selection', (name, call) => {
  it('names it a chunk and points at the bounds on it', async () => {
    const message = await refusal(call, aChunk);
    expect(message).toContain(`${name}(): the selection is a chunk`);
    expect(message).toContain('.startSeconds');
  });

  it('no longer blames the field it happened to read next', async () => {
    const message = await refusal(call, aChunk);
    expect(message).not.toContain('signalIndices is missing');
    expect(message).not.toContain('buckets must be');
    expect(message).not.toContain('secondsPerBucket must be');
    expect(message).not.toContain('no BioSemi Status channel');
  });
});
