/**
 * Parse options handed over as the Promise that will produce them.
 *
 * The read half went in 0.6.258 and states the shape: every field is read off the object rather than
 * awaited, so each one silently takes its default. Here the field is `strict`, and the default is the
 * one this guard's own sentence is about — the parse "collected its diagnostics rather than throwing
 * on the first of them", for a caller who had asked to receive no such file at all.
 *
 * `parseHeader` is the sharp case. It is synchronous and `strict` is its only option, so `strict` is
 * the WHOLE of what a caller behind an async settings lookup holds: nothing else on the object could
 * have survived to make the call look wrong. `decodeAnnotations` is the same one argument along.
 *
 * `openEdf` and `readHeader` take both families and were already refused by the read guard, which is
 * what `io/read.ts` means by "`OpenOptions` carries both families". They are pinned here too, so the
 * two halves cannot drift into disagreeing about the same argument.
 *
 * A property read, never a call. A Promise that never settles is refused rather than awaited, which
 * is the rule `describeValue` states for its own branch.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import { minimalEdfPlus } from '../support/writer.js';

const bytes = minimalEdfPlus();
const header = parseHeader(bytes, bytes.byteLength);

/** What a caller's own async settings lookup hands back if the await is left off. */
const pendingOptions = (): unknown => Promise.resolve({ strict: true });

describe('a parse given the Promise its options are behind', () => {
  it('is refused by the synchronous primitive, whose only option this is', () => {
    expect(() => parseHeader(bytes, bytes.byteLength, pendingOptions() as never)).toThrow(
      /the parse options are a pending Promise/,
    );
  });

  it('is refused by decodeAnnotations, one argument along', () => {
    expect(() =>
      decodeAnnotations(
        header,
        new Uint8Array(header.recordByteLength),
        { start: 0, count: 1 },
        pendingOptions() as never,
      ),
    ).toThrow(/the parse options are a pending Promise/);
  });

  it('names what taking the lenient default cost', () => {
    let message = '';
    try {
      parseHeader(bytes, bytes.byteLength, pendingOptions() as never);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('strict is read off the object rather than awaited');
    expect(message).toContain('collected its diagnostics rather than throwing');
    expect(message).toContain('Next: await them');
  });

  it('is a caller mistake, so it is a plain RangeError', () => {
    expect(() => parseHeader(bytes, bytes.byteLength, pendingOptions() as never)).toThrow(
      RangeError,
    );
  });

  it('does not await, settle or subscribe to what it was given', () => {
    const neverSettles = new Promise<never>(() => {});
    // It never settles, so a guard that awaited it could not throw synchronously at all.
    expect(() => parseHeader(bytes, bytes.byteLength, neverSettles as never)).toThrow(
      /a pending Promise/,
    );
  });
});

describe('the two entry points that carry both families', () => {
  it('are refused as well, so the halves cannot disagree', async () => {
    await expect(openEdf(byteSource(bytes), pendingOptions() as never)).rejects.toThrow(
      /a pending Promise/,
    );
    await expect(readHeader(byteSource(bytes), pendingOptions() as never)).rejects.toThrow(
      /a pending Promise/,
    );
  });
});

describe('the options that were always right', () => {
  it('still parse, and still parse strictly when asked', async () => {
    const options = await (pendingOptions() as Promise<{ strict: boolean }>);
    expect(() => parseHeader(bytes, bytes.byteLength, options)).not.toThrow();
    expect(parseHeader(bytes, bytes.byteLength).signals.length).toBeGreaterThan(0);
  });

  it('are still optional', () => {
    expect(() => parseHeader(bytes, bytes.byteLength, undefined)).not.toThrow();
    expect(() => parseHeader(bytes, bytes.byteLength, {})).not.toThrow();
  });
});

describe('the branches that were already there', () => {
  it('keep their own sentences', () => {
    expect(() => parseHeader(bytes, bytes.byteLength, [true] as never)).toThrow(
      /the parse options are an array/,
    );
    expect(() => parseHeader(bytes, bytes.byteLength, true as never)).toThrow(/not an object/);
    expect(() => parseHeader(bytes, bytes.byteLength, { strict: 'true' } as never)).toThrow(
      /options.strict must be true or false/,
    );
  });
});
