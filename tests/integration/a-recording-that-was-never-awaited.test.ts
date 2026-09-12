/**
 * What the reading API does when the recording argument is the Promise `openEdf` returns.
 *
 * 0.6.79 guarded the SELECTION — the second argument — and left the first one unchecked. The
 * mistake it invites is the one every async API invites: `openEdf` is the only call a reader makes
 * before any other, it returns a Promise, and a forgotten `await` hands that Promise straight to
 * `readWindow`. It reached `recording.header.signals` and threw V8's `Cannot read properties of
 * undefined (reading 'signals')`: a `TypeError` with no `Next:` clause, naming an internal field
 * rather than the argument, and saying nothing about the one keyword that fixes it (fixed in
 * 0.6.89).
 *
 * A Promise is worth naming as itself. Every other wrong first argument is some object that is not
 * a recording; this one is a recording, one tick later.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const source = () => byteSource(FILE);

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 1 };
const RECORDS = { records: { start: 0, count: 1 }, signalIndices: [0] };

/** The cast a JavaScript caller does not need: the type system is not the only way in. */
const withRecording = (fn: unknown) => fn as (recording: unknown, selection: unknown) => unknown;

const CALLS: ReadonlyArray<readonly [string, unknown, unknown]> = [
  ['readWindow', readWindow, WINDOW],
  ['readRecords', readRecords, RECORDS],
];

async function thrownBy(fn: unknown, recording: unknown, selection: unknown): Promise<Error> {
  try {
    await withRecording(fn)(recording, selection);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was accepted with no recording');
}

describe.each(CALLS)('%s handed the Promise instead of what it resolves to', (name, fn, sel) => {
  it('names the call, the Promise and the keyword that fixes it', async () => {
    const pending = openEdf(source());
    const { message } = await thrownBy(fn, pending, sel);
    expect(message).toContain(`${name}():`);
    expect(message).toContain('the recording is a pending Promise');
    expect(message).toContain('Next: pass `await openEdf(source)`');
    await pending;
  });

  it('is a RangeError, not V8 reading an internal field', async () => {
    const pending = openEdf(source());
    const error = await thrownBy(fn, pending, sel);
    expect(error).toBeInstanceOf(RangeError);
    expect(error.message).not.toContain('Cannot read properties');
    await pending;
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const pending = openEdf(source());
    expect(isEdfError(await thrownBy(fn, pending, sel))).toBe(false);
    await pending;
  });
});

describe('the other ways the first argument arrives wrong', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['a string', 'recording.edf'],
  ])('says it is %s', async (described, recording) => {
    const { message } = await thrownBy(readWindow, recording, WINDOW);
    expect(message).toContain(`the recording is ${described}`);
    expect(message).toContain('not the object openEdf() returns');
  });
});

describe('the header, which is what every primitive in this package takes', () => {
  it('is named as a header rather than reported as "an object"', async () => {
    const recording = await openEdf(source());
    const { message } = await thrownBy(readWindow, recording.header, WINDOW);
    expect(message).toContain('readWindow(): that is a header, not a recording');
    expect(message).toContain('the source, the timeline and the index');
    expect(message).toContain('rather than its .header');
  });

  it('is not confused with a forgotten await', async () => {
    const recording = await openEdf(source());
    const asHeader = await thrownBy(readRecords, recording.header, RECORDS);
    expect(asHeader.message).not.toContain('pending Promise');
    const pending = openEdf(source());
    expect((await thrownBy(readRecords, pending, RECORDS)).message).not.toContain('is a header');
    await pending;
  });
});

describe('a recording that was awaited', () => {
  it('still reads, so the guard costs nothing a caller notices', async () => {
    const recording: EdfRecording = await openEdf(source());
    const chunks = await readWindow(recording, WINDOW);
    expect(chunks).toHaveLength(1);
  });
});
