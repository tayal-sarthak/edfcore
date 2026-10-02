/**
 * The `index` option of `validateRecording`, when it is not an index.
 *
 * `usableIndex` answers one question — is this a complete index for this file — and answers it with
 * `undefined` for four different reasons: not an index at all, a probed one, one built for a
 * different record count, one missing its segments. Three of those are a reason to rebuild and say
 * nothing. The first is a caller mistake, and it was silent too.
 *
 * `validateRecording(recording, { index: buildRecordIndex(recording) })` is how it gets written.
 * This option exists, in `types.ts`' own words, to "reuse a completed index so conformance costs one
 * traversal, not two" — so it is reached for on exactly the files where a traversal is expensive, and
 * it is handed the result of an async call. One keyword short, the option was dropped, the sweep read
 * the whole file again, and the report at the end of it was correct. Nothing said the index had gone
 * unused; the only symptom was the cost the option was added to avoid.
 *
 * `coverage` is the test, because it is the field the other two index-taking calls identify one by:
 * "the second argument is not a record index — it has no coverage".
 *
 * The three silent cases stay silent, and are pinned here so they do not become refusals by accident.
 * A probed index cannot be reused, an index for a different record count is the wrong file's, and one
 * missing its segments has nothing to reuse — all three are real indices, and rebuilding is the right
 * answer for them.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecordIndex, EdfRecording, ValidateOptions } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf, minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();
const open = (source: Uint8Array = bytes): Promise<EdfRecording> => openEdf(byteSource(source));

type Validate = (recording: EdfRecording, options: unknown) => Promise<unknown>;
const validate = validateRecording as unknown as Validate;

const refusal = async (call: () => unknown): Promise<string> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

describe('a value that is not an index', () => {
  it('is refused rather than discarded', async () => {
    const recording = await open();
    const pending = buildRecordIndex(recording);
    const message = await refusal(() => validate(recording, { index: pending }));
    expect(message).toContain('not a record index');
    await pending;
  });

  it('names what the silent rebuild cost', async () => {
    const recording = await open();
    const message = await refusal(() => validate(recording, { index: [] }));
    expect(message).toContain('silently rebuilt one and read the whole file again');
    expect(message).toContain('the cost the option exists to avoid');
  });

  it('says what to pass, including the keyword', async () => {
    const recording = await open();
    const message = await refusal(() => validate(recording, { index: 5 }));
    expect(message).toContain('await buildRecordIndex(recording)');
    expect(message).toContain('recording.index');
  });

  it('is refused for every shape that carries no coverage', async () => {
    const recording = await open();
    const shapes: ReadonlyArray<readonly [string, unknown]> = [
      ['a header', recording.header],
      ['a recording', recording],
      ['an array', []],
      ['a number', 5],
      ['a string', 'index'],
      ['null', null],
    ];
    for (const [name, index] of shapes) {
      expect(await refusal(() => validate(recording, { index })), name).toContain(
        'not a record index',
      );
    }
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const recording = await open();
    await expect(validate(recording, { index: [] })).rejects.toThrow(RangeError);
  });
});

describe('the three real indices that cannot be reused', () => {
  it('stay silent for a probed one, which is what recording.index is', async () => {
    const recording = await open();
    expect(recording.index.coverage).toBe('probed');
    await expect(validateRecording(recording, { index: recording.index })).resolves.toMatchObject({
      ok: expect.any(Boolean),
    });
  });

  it('stay silent for one built from a different file', async () => {
    const other = await open(
      buildEdf({
        format: 'EDF',
        recordCount: 5,
        recordDurationSeconds: 1,
        signals: [{ label: 'EEG Fp1', samplesPerRecord: 4 }],
      }),
    );
    const recording = await open();
    const mismatched = await buildRecordIndex(other);
    expect(mismatched.recordCount).not.toBe(recording.header.recordCount);
    await expect(validateRecording(recording, { index: mismatched })).resolves.toMatchObject({
      ok: expect.any(Boolean),
    });
  });

  it('stay silent for a complete index with no segments on it', async () => {
    const recording = await open();
    const complete = await buildRecordIndex(recording);
    const stripped = { ...complete, segments: undefined } as unknown as EdfRecordIndex;
    await expect(validateRecording(recording, { index: stripped })).resolves.toMatchObject({
      ok: expect.any(Boolean),
    });
  });
});

describe('an index that can be reused', () => {
  it('still is, and the report is the same either way', async () => {
    const recording = await open();
    const index = await buildRecordIndex(recording);
    const options = { index } satisfies ValidateOptions;
    const reused = await validateRecording(recording, options);
    const fresh = await validateRecording(recording);
    expect(reused.ok).toBe(fresh.ok);
    expect(reused.diagnostics.map((d) => d.code)).toEqual(fresh.diagnostics.map((d) => d.code));
  });

  it('is still optional', async () => {
    const recording = await open();
    await expect(validateRecording(recording, {})).resolves.toMatchObject({
      ok: expect.any(Boolean),
    });
  });
});
