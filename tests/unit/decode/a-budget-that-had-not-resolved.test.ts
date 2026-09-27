/**
 * `MaterializeOptions` handed over as the Promise that will produce it.
 *
 * 0.6.248 gave this family its first guard at all, and gave the reason: `MaterializeOptions` "carries
 * that field and nothing else, so the number is the WHOLE of what a caller holds". A pending Promise
 * is that sentence again from the other side — there is no second field left on the object that could
 * have made the call look wrong, so nothing about the result says the cap was dropped.
 *
 * And the cap is the point. `maxMaterializeBytes` exists, as the field's own docblock puts it, to
 * "refuse before allocating rather than dying inside it". Read as `undefined` it takes the 256 MiB
 * default and the allocation goes ahead: a caller who capped a browser tab at four megabytes got the
 * refusal that cap exists for on no call at all.
 *
 * Three calls resolve it: `toPhysical`, `clampToDigitalRange` and `decodeDigital`. The read half of
 * this shape went in 0.6.258, the parse half in 0.6.259 and the listing half in 0.6.260.
 *
 * A property read, never a call. A Promise that never settles is refused rather than awaited.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../../src/decode/physical.js';
import { parseHeader } from '../../../src/header/parse.js';
import { minimalEdf } from '../../support/writer.js';

const bytes = minimalEdf();
const header = parseHeader(bytes, bytes.byteLength);
const signal = header.signals[0];
if (signal === undefined) throw new Error('fixture has no signal');

/** What a caller's own async settings lookup hands back if the await is left off. */
const pendingOptions = (): unknown => Promise.resolve({ maxMaterializeBytes: 4 * 1024 * 1024 });

describe('a conversion given the Promise its budget is behind', () => {
  it('is refused rather than allocating under the default', () => {
    expect(() => toPhysical(signal, [1, 2, 3], undefined, pendingOptions() as never)).toThrow(
      /the options are a pending Promise/,
    );
  });

  it('names the field and says the default was taken and the allocation made', () => {
    let message = '';
    try {
      toPhysical(signal, [1, 2, 3], undefined, pendingOptions() as never);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('maxMaterializeBytes is read off the object rather than awaited');
    expect(message).toContain('took the default budget and allocated');
    expect(message).toContain('Next: await them');
  });

  it('names the call it came from', () => {
    expect(() => toPhysical(signal, [1, 2], undefined, pendingOptions() as never)).toThrow(
      /^toPhysical\(\)/,
    );
    expect(() =>
      clampToDigitalRange(signal, Int32Array.of(1, 2), undefined, pendingOptions() as never),
    ).toThrow(/^clampToDigitalRange\(\)/);
  });

  it('is refused by every call that resolves this family', () => {
    const records = { start: 0, count: header.recordCount };
    const recordBytes = new Uint8Array(header.recordByteLength * header.recordCount);
    const calls: ReadonlyArray<readonly [string, () => unknown]> = [
      ['toPhysical', () => toPhysical(signal, [1, 2], undefined, pendingOptions() as never)],
      [
        'clampToDigitalRange',
        () =>
          clampToDigitalRange(signal, Int32Array.of(1, 2), undefined, pendingOptions() as never),
      ],
      [
        'decodeDigital',
        () => decodeDigital(header, recordBytes, records, 0, undefined, pendingOptions() as never),
      ],
    ];
    for (const [name, call] of calls) {
      expect(call, name).toThrow(/a pending Promise/);
    }
  });

  it('is a caller mistake, so it is a plain RangeError', () => {
    expect(() => toPhysical(signal, [1, 2], undefined, pendingOptions() as never)).toThrow(
      RangeError,
    );
  });

  it('is never awaited, settled or subscribed to', () => {
    const neverSettles = new Promise<never>(() => {});
    expect(() => toPhysical(signal, [1, 2], undefined, neverSettles as never)).toThrow(
      /a pending Promise/,
    );
  });
});

describe('the budget that was always right', () => {
  it('still refuses an allocation above it', async () => {
    const options = await (pendingOptions() as Promise<{ maxMaterializeBytes: number }>);
    expect(() => toPhysical(signal, [1, 2], undefined, options)).not.toThrow();
    expect(() => toPhysical(signal, [1, 2], undefined, { maxMaterializeBytes: 0 })).toThrow();
  });

  it('is still optional', () => {
    expect(() => toPhysical(signal, [1, 2])).not.toThrow();
    expect(() => toPhysical(signal, [1, 2], undefined, undefined)).not.toThrow();
    expect(() => toPhysical(signal, [1, 2], undefined, {})).not.toThrow();
  });
});

describe('the branches that were already there', () => {
  it('keep their own sentences', () => {
    expect(() => toPhysical(signal, [1, 2], undefined, [4 * 1024 * 1024] as never)).toThrow(
      /the options are an array/,
    );
    expect(() => toPhysical(signal, [1, 2], undefined, (4 * 1024 * 1024) as never)).toThrow(
      /not an object/,
    );
  });
});
