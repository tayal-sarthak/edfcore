/**
 * `inspectEdf` diagnoses the file and refuses to diagnose the caller.
 *
 * Triage is the call that meets an unknown file, so it reports defects rather than throwing them:
 * a header that fails its grammar comes back as `ok: false` with the diagnostics that led there,
 * and nothing about the bytes can make this function throw. That is the whole contract, and it is
 * well covered.
 *
 * The other half was not. The `catch` inside `inspectEdf` starts `if (!isEdfError(error)) throw
 * error`, and that line is the boundary between the two kinds of failure — a file defect arrives
 * as an `EdfError` and becomes a diagnostic; a caller mistake arrives as a plain `RangeError` and
 * must stay one. Nothing in the suite had ever thrown a non-`EdfError` out of `parseHeader`, so
 * the rethrow never ran and turning it into `return` would have gone unnoticed. What that costs
 * is specific: `EdfInspection` has no field for "the arguments were wrong", so a swallowed
 * `RangeError` would come back as `ok: false` with a diagnostic blaming the file for a number the
 * caller supplied.
 *
 * The reachable caller bug is a `ByteSource` whose `byteLength` is past 2^53 — a hand-written
 * adapter over a paged API, or a `Content-Range` nobody checked. `assertByteSource` accepts it,
 * because it is a number; `parseHeader` refuses it, because it cannot be a byte count.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import type { ByteSource } from '../../src/types.js';
import { buildEdf, minimalEdf } from '../support/writer.js';

const HEADER = minimalEdf();

/** A well-formed file behind a source that lies about how large it is. */
function sourceClaiming(byteLength: number, bytes: Uint8Array = HEADER): ByteSource {
  return {
    byteLength,
    read: (offset: number, length: number) => {
      const out = new Uint8Array(length);
      out.set(bytes.subarray(offset, Math.min(bytes.length, offset + length)));
      return Promise.resolve(out);
    },
  };
}

async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  const caught = await call().then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
  if (caught === undefined) throw new Error('the call resolved and was supposed to throw');
  return caught.error;
}

describe('a defect in the file', () => {
  it('comes back as a diagnostic, because that is what triage is for', async () => {
    // The anchor for everything below: bytes this bad still do not throw, so a throw in the next
    // block cannot be "inspectEdf throws on anything unusual".
    const noAnnotations = buildEdf({
      plus: 'C',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    const inspection = await inspectEdf(sourceClaiming(noAnnotations.byteLength, noAnnotations));
    expect(inspection.ok).toBe(false);
    expect(inspection.diagnostics.map((d) => d.code)).toContain(
      'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
    );
  });
});

describe('a mistake in the arguments', () => {
  it('is thrown, not turned into a diagnostic about the file', async () => {
    const error = await thrownBy(() => inspectEdf(sourceClaiming(1e21)));

    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toContain('sourceByteLength must be a non-negative safe');
    // The bytes are a perfectly good EDF file, so nothing here is a statement about them.
    expect((error as RangeError).message).toContain('source.byteLength for a ByteSource');
  });

  it('stays outside the EdfError family, so a caller’s triage does not absorb it', async () => {
    // `isEdfError` is the documented cross-realm test, and the codepath being pinned is literally
    // `if (!isEdfError(error)) throw error`. A caller writing the recommended
    // `catch (e) { if (isEdfError(e)) report(e); else throw e }` must rethrow this one.
    const error = await thrownBy(() => inspectEdf(sourceClaiming(1e21)));
    expect(isEdfError(error)).toBe(false);
  });

  it('accepts the same file once the source states a size it can address', async () => {
    // Non-vacuity: the refusal is about the number, not about the fixture or the adapter shape.
    const inspection = await inspectEdf(sourceClaiming(HEADER.byteLength));
    expect(inspection.ok).toBe(true);
    expect(inspection.header?.signals).toHaveLength(1);
  });
});
