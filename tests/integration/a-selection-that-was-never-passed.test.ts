/**
 * What the reading API does when the selection argument is not there at all.
 *
 * `assertSignalIndices` already makes the argument for guarding this, and states it plainly:
 * omitting a required field "was a caller mistake the type system catches — and TypeScript is not
 * the only way in. A selection built from JSON, from a config file, from a JavaScript call site,
 * or from an object spread that dropped a [field]" reaches the same place.
 *
 * It was made one level too deep. Reaching that guard means dereferencing `selection`, so a caller
 * who omitted the whole object got V8's `TypeError: Cannot read properties of undefined (reading
 * 'signalIndices')` — no `Next:` clause, naming an internal field rather than the argument, out of
 * a package where a plain `RangeError` is what a caller mistake is supposed to look like.
 * `readWindow`, `readRecords`, `readEnvelope`, `streamRecords` and `readTriggers` all did it, each
 * naming whichever field it happened to read first (fixed in 0.6.79).
 *
 * `readTriggers` showed the shape worst. Its Status-channel guard runs first, so a file WITHOUT a
 * Status channel produced the good message and a file WITH one produced the `TypeError` — the
 * quality of the error depended on the file rather than on the call.
 *
 * `readAnnotations` and `readRecordBytes` take a record range rather than a selection object and
 * already refused it as an `EdfRangeError`; they are checked here so the sweep covers the whole
 * reading surface rather than the part that was broken.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** A BDF+C file with a Status channel, so `readTriggers` gets past its own first guard. */
const FILE = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = () => openEdf(byteSource(FILE));

/** Called with the selection omitted, the way a JavaScript caller can. */
type OneArgument = (recording: EdfRecording) => unknown;

/** The cast every entry below needs: these functions require a second argument, and that is the
 *  point — a JavaScript caller can omit it and the type system is not there to stop them. */
const withoutSelection = (fn: unknown): OneArgument => fn as OneArgument;

const TAKE_A_SELECTION: ReadonlyArray<readonly [string, OneArgument]> = [
  ['readWindow', withoutSelection(readWindow)],
  ['readRecords', withoutSelection(readRecords)],
  ['readEnvelope', withoutSelection(readEnvelope)],
  ['readTriggers', withoutSelection(readTriggers)],
  [
    'streamRecords',
    (recording) => (withoutSelection(streamRecords)(recording) as AsyncGenerator<unknown>).next(),
  ],
];

async function thrownBy(call: OneArgument): Promise<Error> {
  const recording = await opened();
  try {
    await call(recording);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was accepted with no selection');
}

describe.each(TAKE_A_SELECTION)('%s with no selection', (name, call) => {
  it('throws a RangeError rather than a TypeError', async () => {
    const error = await thrownBy(call);
    expect(error).toBeInstanceOf(RangeError);
    expect(error.name).toBe('RangeError');
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    expect(isEdfError(await thrownBy(call))).toBe(false);
  });

  it('names the call, the argument and what to pass', async () => {
    const { message } = await thrownBy(call);
    expect(message).toContain(`${name}():`);
    expect(message).toContain('the selection is missing, not an object');
    expect(message).toMatch(/Next: pass \{ .+ \}/);
  });

  it('says nothing about an internal field it happened to read first', async () => {
    expect((await thrownBy(call)).message).not.toContain('Cannot read properties');
  });
});

describe('null, which a config file produces as easily as undefined', () => {
  it('is refused the same way and named as itself', async () => {
    const recording = await opened();
    const thrown = await Promise.resolve()
      .then(() =>
        (readWindow as unknown as (r: EdfRecording, s: unknown) => unknown)(recording, null),
      )
      .catch((error: unknown) => error as Error);
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toContain('the selection is null');
  });
});

describe('the two that take a record range instead', () => {
  it('already refused it as an EdfRangeError, and still do', async () => {
    const recording = await opened();
    for (const call of [
      () => withoutSelection(readAnnotations)(recording),
      () =>
        (readRecordBytes as unknown as (s: unknown, h: unknown) => unknown)(
          recording.source,
          recording.header,
        ),
    ]) {
      const thrown = await Promise.resolve()
        .then(call)
        .catch((error: unknown) => error as Error);
      expect(isEdfError(thrown)).toBe(true);
    }
  });
});
