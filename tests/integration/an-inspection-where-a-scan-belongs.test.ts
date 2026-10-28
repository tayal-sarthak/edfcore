/**
 * What `inspectEdf` resolves to, handed to the two calls that scan the whole file.
 *
 * `buildRecordIndex` and `validateRecording` each keep their own copy of the recording guard rather
 * than sharing `assertRecording`, and each accepted anything carrying a `header` object. An
 * inspection carries one — it is the triage result, and it holds the header and nothing else — so
 * both walked into the scan and failed on whatever was missing first.
 */

import { describe, expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { validateHeader, validateRecording } from '../../src/validate.js';
import { minimalEdfPlus } from '../support/writer.js';

const inspected = () => inspectEdf(byteSource(minimalEdfPlus({ recordCount: 2 })));

const refusal = (call: () => Promise<unknown>): Promise<Error | undefined> =>
  call().then(
    () => undefined,
    (error: unknown) => error as Error,
  );

describe('an inspection where a whole-file scan belongs', () => {
  it('is named by buildRecordIndex, rather than refused as a missing source', async () => {
    const inspection = await inspected();
    const thrown = await refusal(() => buildRecordIndex(inspection as never));
    expect(thrown?.message).toContain('buildRecordIndex(): that is an inspection');
    expect(thrown?.message).not.toContain('a ByteSource is needed');
  });

  it('is named by validateRecording, rather than crashing on a field it lacks', async () => {
    const inspection = await inspected();
    const thrown = await refusal(() => validateRecording(inspection as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('validateRecording(): that is an inspection');
    expect(thrown?.message).not.toContain('Cannot read properties');
  });

  it('points at the header check the inspection can still have', async () => {
    const inspection = await inspected();
    expect(inspection.header).toBeDefined();
    expect(Array.isArray(validateHeader(inspection.header as never))).toBe(true);
  });
});
