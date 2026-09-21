/**
 * "Or call readRecords(), which is the one that takes records", said by five calls that share one
 * guard and by two that have such a sibling.
 *
 * 0.6.87 wrote the clause for `readWindow`, where it is exactly right: `readWindow` and
 * `readRecords` are the same read in two units, and `streamRecords` — called streamRECORDS, and
 * taking a window — is the other call the sentence was written for.
 *
 * `assertSelection` is shared by five. For the other three the advice names a call that does
 * something else:
 *
 * - `readEnvelope` and `readEnvelopeAtResolution` have no records form. `readRecords` hands back
 *   samples; reducing them to an envelope is a second call, `envelopeOfSamples`, and the advice
 *   named only the first step of a two-step answer.
 * - `readTriggers` has no records form at all. It decodes BioSemi trigger EVENTS, so a reader who
 *   follows the advice gets the Status channel's samples — after finding that channel themselves —
 *   rather than the events they asked for.
 *
 * The clause is a parameter now, defaulted so the two calls it was written for keep it verbatim.
 * Nothing else about the refusal changes: same branch, same class, same shape in the `Next:`.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** BDF with a Status channel, so `readTriggers` reaches its selection guard rather than the file. */
const FILE = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const RECORDS = { start: 0, count: 2 };

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

const withRecords = async (
  call: (recording: EdfRecording, selection: unknown) => unknown,
  extra: Record<string, unknown> = {},
): Promise<Error> => {
  const recording = await opened();
  return refusal(() => call(recording, { records: RECORDS, signalIndices: [0], ...extra }));
};

describe('the two calls the clause was written for', () => {
  it.each([
    ['readWindow', (r: EdfRecording, s: unknown) => readWindow(r, s as never)],
    [
      'streamRecords',
      async (r: EdfRecording, s: unknown) => {
        for await (const chunk of streamRecords(r, s as never)) void chunk;
      },
    ],
  ])('keeps it verbatim: %s', async (_name, call) => {
    const thrown = await withRecords(call);
    expect(thrown.message).toContain('or call readRecords(), which is the one that takes records.');
  });
});

describe('the envelope pair, which has no records form', () => {
  it.each([
    ['readEnvelope', (r: EdfRecording, s: unknown) => readEnvelope(r, s as never), { buckets: 4 }],
    [
      'readEnvelopeAtResolution',
      (r: EdfRecording, s: unknown) => readEnvelopeAtResolution(r, s as never),
      { secondsPerBucket: 0.5 },
    ],
  ])('no longer names readRecords as the one that would do it: %s', async (_n, call, extra) => {
    const thrown = await withRecords(call, extra);
    expect(thrown.message).not.toContain('which is the one that takes records');
    expect(thrown.message).toContain('there is no records form of an envelope');
  });

  it.each([
    ['readEnvelope', (r: EdfRecording, s: unknown) => readEnvelope(r, s as never), { buckets: 4 }],
    [
      'readEnvelopeAtResolution',
      (r: EdfRecording, s: unknown) => readEnvelopeAtResolution(r, s as never),
      { secondsPerBucket: 0.5 },
    ],
  ])('names both steps of the answer instead: %s', async (_n, call, extra) => {
    const thrown = await withRecords(call, extra);
    expect(thrown.message).toContain('readRecords() gives you those records as samples');
    expect(thrown.message).toContain('envelopeOfSamples() reduces each signal of them');
  });
});

describe('readTriggers, which has no records form at all', () => {
  const call = (r: EdfRecording, s: unknown): unknown => readTriggers(r, s as never);

  it('no longer sends a trigger scan to a sample read', async () => {
    const thrown = await withRecords(call);
    expect(thrown.message).not.toContain('which is the one that takes records');
    expect(thrown.message).toContain('there is no records form of a trigger scan');
  });

  it('says what readRecords would actually have given them', async () => {
    const thrown = await withRecords(call);
    expect(thrown.message).toContain('the Status channel as samples');
    expect(thrown.message).toContain('you would still have to find and decode');
  });

  it('is reached on a file that really has a Status channel', async () => {
    const recording = await opened();
    expect(recording.header.signals.map((signal) => signal.label)).toContain('Status');
  });
});

describe('the rest of the refusal', () => {
  it.each([
    ['readWindow', (r: EdfRecording, s: unknown) => readWindow(r, s as never), {}],
    ['readEnvelope', (r: EdfRecording, s: unknown) => readEnvelope(r, s as never), { buckets: 4 }],
    ['readTriggers', (r: EdfRecording, s: unknown) => readTriggers(r, s as never), {}],
  ])('keeps the branch, the class and the shape: %s', async (_n, call, extra) => {
    const thrown = await withRecords(call, extra);
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('the selection has a `records` range');
    expect(thrown.message).toContain('this call takes a time window');
    expect(thrown.message).toContain('Next: pass { ');
  });

  it('leaves readRecords itself alone, which takes the records', async () => {
    const recording = await opened();
    const chunk = await readRecords(recording, { records: RECORDS, signalIndices: [0] });
    expect(chunk.signals).toHaveLength(1);
  });

  it('still reads for the window each call does take', async () => {
    const recording = await opened();
    const window = { signalIndices: [0], startSeconds: 0, durationSeconds: 2 };
    expect(await readWindow(recording, window)).toBeDefined();
    expect(await readEnvelope(recording, { ...window, buckets: 4 })).toBeDefined();
    expect(await readTriggers(recording, { startSeconds: 0, durationSeconds: 2 })).toBeDefined();
  });
});
