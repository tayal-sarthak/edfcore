/**
 * What `inspectEdf` resolves to, handed to the calls that read records.
 *
 * `inspectEdf` is the documented first call on an unknown file, so its result is the other object
 * a reader holds beside a recording — and it carries a `header`, which is all `assertRecording`
 * asked for. So it walked through, and the read failed wherever a source, a timeline or an index
 * was first touched. `readWindow` blamed `resolveTimeWindow()`, a call the reader never made, and
 * told them to pass `recording.timeline`, a field of the object they did not have.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { minimalEdfPlus } from '../support/writer.js';

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 1 };

type Call = (inspection: never) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  ['readWindow', (inspection) => readWindow(inspection, WINDOW)],
  [
    'readRecords',
    (inspection) =>
      readRecords(inspection, { signalIndices: [0], records: { start: 0, count: 1 } }),
  ],
  ['readAnnotations', (inspection) => readAnnotations(inspection, { start: 0, count: 1 })],
  [
    'streamRecords',
    async (inspection) => {
      for await (const chunk of streamRecords(inspection, WINDOW)) return chunk;
      return undefined;
    },
  ],
  ['readEnvelope', (inspection) => readEnvelope(inspection, { ...WINDOW, buckets: 4 })],
  [
    'readEnvelopeAtResolution',
    (inspection) => readEnvelopeAtResolution(inspection, { ...WINDOW, secondsPerBucket: 0.5 }),
  ],
  [
    'readTriggers',
    (inspection) => readTriggers(inspection, { startSeconds: 0, durationSeconds: 1 }),
  ],
];

describe.each(CALLS)('%s, given what inspectEdf resolved to', (name, call) => {
  it('names it an inspection and says what it lacks', async () => {
    const inspection = await inspectEdf(byteSource(minimalEdfPlus({ recordCount: 2 })));
    expect(inspection.ok).toBe(true);
    const thrown = await call(inspection as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain(`${name}(): that is an inspection`);
    expect(thrown?.message).toContain('openEdf(source)');
    expect(thrown?.message).not.toContain('resolveTimeWindow()');
  });
});
