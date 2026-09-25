/**
 * `validateRecording`'s read options, on a file the sweep does not have to read.
 *
 * The sweep traverses when `scanSamples` is on or when the onsets live in the records, and on a
 * plain EDF asked for the cheap check neither is true — so nothing below the option guards ever
 * looked at the options, and `assertReadOptions` was reached from inside a traversal that did not
 * happen. One line of a caller's code was refused against an EDF+ recording and accepted in silence
 * against an EDF one.
 *
 * `[controller.signal]` is the spelling `assertReadOptions` was given its array branch for, and its
 * own note names `validateRecording(recording, true)` among the calls "the rest of the package has
 * been closing since 0.6.130" — while this was the one call that never asked it anything.
 *
 * `record-index.ts` states the rule for `locate` and `onsetTicks`: "the read options, HERE, because
 * nothing downstream of this line can ever see them". There the laundering is a spread; here it is
 * the file.
 *
 * The bare-value guard above it keeps its own sentence, which names `scanSamples` rather than the
 * read options, because `validateRecording(recording, true)` is a mistake about this call and not
 * about a read.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording, ValidateOptions } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

async function open(bytes: Uint8Array): Promise<EdfRecording> {
  return openEdf(byteSource(bytes));
}

type Validate = (recording: EdfRecording, options: unknown) => Promise<unknown>;
const validate = validateRecording as unknown as Validate;

/** Each of these is refused on an EDF+ file, where the sweep has to read the onsets. */
const WRONG: ReadonlyArray<readonly [string, unknown]> = [
  ['a signal wrapped in a list', [{ aborted: false }]],
  ['an empty list', []],
  ['the signal handed over as the whole options object', { aborted: false }],
];

describe.each(WRONG)('%s', (_name, options) => {
  it('is refused on an EDF+ recording, where the sweep reads the onsets', async () => {
    const recording = await open(minimalEdfPlus());
    await expect(validate(recording, options)).rejects.toThrow(RangeError);
  });

  it('is refused on a plain EDF recording, which the cheap sweep never reads', async () => {
    const recording = await open(minimalEdf());
    await expect(validate(recording, options)).rejects.toThrow(RangeError);
  });

  it('is refused in the same words either way, so the message does not describe the file', async () => {
    const message = async (bytes: Uint8Array): Promise<string | undefined> => {
      try {
        await validate(await open(bytes), options);
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    };
    expect(await message(minimalEdf())).toBe(await message(minimalEdfPlus()));
  });
});

describe('the options that were always right', () => {
  it('still validate a plain EDF recording with none at all', async () => {
    const recording = await open(minimalEdf());
    await expect(validateRecording(recording)).resolves.toMatchObject({ ok: expect.any(Boolean) });
  });

  it('still take a real options object, and still run the expensive half', async () => {
    const recording = await open(minimalEdf());
    const report = await validateRecording(recording, { scanSamples: true });
    expect(report.recordsScanned).toBe(recording.header.recordCount);
  });

  it('still take a signal on the field it belongs on', async () => {
    const recording = await open(minimalEdf());
    const options = { signal: new AbortController().signal } as ValidateOptions;
    await expect(validateRecording(recording, options)).resolves.toMatchObject({
      ok: expect.any(Boolean),
    });
  });
});

describe('the bare-value guard above it', () => {
  it('still names scanSamples rather than the read options', async () => {
    const recording = await open(minimalEdf());
    await expect(validate(recording, true)).rejects.toThrow(/scanSamples is a field on one/);
  });
});
