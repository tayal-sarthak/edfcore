/**
 * "Or what parseHeader(bytes, sourceByteLength) returned", said to someone who used `readHeader`.
 *
 * Four guards in this package end on that clause, and 0.6.217 gave the argument against it while
 * fixing the first: "The next step names `parseHeader`, which is synchronous — but the call a
 * reader reaches for when they have a SOURCE rather than bytes is `readHeader`, and that one is
 * async. So `getSignal(readHeader(source), 'Fp1')` is one keyword short, and was told it had passed
 * something with no signals: true of a pending Promise, and true of almost everything else, so it
 * named nothing a reader could act on."
 *
 * 0.6.229 carried it to `validateHeader`. The other three kept the clause and not the branch:
 *
 * - `formatHeader`, the printer — "print the header I just read" is what its name offers.
 * - `declaredDurationSeconds`, the one lookup in `header/lookup.ts` that reads a count rather than
 *   the signals, so it sits outside the guard 0.6.217 fixed.
 * - `readRecordBytes`, which sits directly beside `readHeader` in `io/read.ts` and takes what that
 *   call returns as its second argument.
 *
 * Each keeps its own field, its own tail and its own class; only the forgotten keyword is named now.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../../src/format-header.js';
import { declaredDurationSeconds, getSignal } from '../../../src/header/lookup.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../../src/io/read.js';
import { openEdf, readWindow } from '../../../src/recording.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

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

interface Guard {
  readonly call: (header: unknown) => unknown;
  /** The field this one names when the argument is simply not a header. */
  readonly field: string;
}

const GUARDS: ReadonlyArray<readonly [string, Guard]> = [
  ['formatHeader', { call: (header) => formatHeader(header as never), field: 'no signals' }],
  [
    'declaredDurationSeconds',
    { call: (header) => declaredDurationSeconds(header as never), field: 'no recordCount' },
  ],
  [
    'readRecordBytes',
    {
      call: (header) => readRecordBytes(byteSource(FILE), header as never, { start: 0, count: 1 }),
      field: 'no recordByteLength',
    },
  ],
];

describe.each(GUARDS)('%s, given readHeader(source) unawaited', (_name, guard) => {
  it('names the keyword rather than the missing field', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => guard.call(pending));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is a pending Promise, not a header');
    expect(thrown.message).not.toContain(guard.field);
    await pending;
  });

  it('names readHeader, which is the async call, rather than parseHeader', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => guard.call(pending));
    expect(thrown.message).toContain('await readHeader(source)');
    expect(thrown.message).toContain('it resolves to the header this takes');
    expect(thrown.message).not.toContain('parseHeader');
    await pending;
  });

  it('says the same thing the guard 0.6.217 fixed says', async () => {
    const pending = readHeader(byteSource(FILE));
    const fromThis = await refusal(() => guard.call(pending));
    const fromLookup = await refusal(() => getSignal(pending as never, 0));
    expect(fromThis.message).toContain('that is a pending Promise, not a header');
    expect(fromLookup.message).toContain('that is a pending Promise, not a header');
    await pending;
  });

  it('still answers once it has arrived', async () => {
    const header = await readHeader(byteSource(FILE));
    expect(await guard.call(header)).toBeDefined();
  });
});

describe('each keeps the refusal it already had', () => {
  it.each(GUARDS)(
    'names its own field for something that is simply not one: %s',
    async (_name, guard) => {
      const thrown = await refusal(() => guard.call({}));
      expect(thrown.message).toContain('that is not a header — it has');
      expect(thrown.message).toContain(guard.field);
      expect(thrown.message).toContain('parseHeader(bytes, sourceByteLength)');
    },
  );

  it('keeps declaredDurationSeconds pointing at timeline.spanSeconds', async () => {
    const thrown = await refusal(() => declaredDurationSeconds({} as never));
    expect(thrown.message).toContain('timeline.spanSeconds');
  });

  it('keeps readRecordBytes saying what the record size measures', async () => {
    const thrown = await refusal(() =>
      readRecordBytes(byteSource(FILE), {} as never, { start: 0, count: 1 }),
    );
    expect(thrown.message).toContain('every offset and length below is measured in');
  });

  it('keeps the formatHeader chunk refusal', async () => {
    const recording = await openEdf(byteSource(FILE));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const thrown = await refusal(() => formatHeader(chunks[0] as never));
    expect(thrown.message).toContain('chunk');
  });
});
