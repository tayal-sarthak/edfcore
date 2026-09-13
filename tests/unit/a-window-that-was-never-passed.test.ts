/**
 * What `filterAnnotationsByTime` does when the window argument is not there at all.
 *
 * `a-selection-that-was-never-passed.test.ts` states the argument: a required object is a caller
 * mistake the type system catches, "and TypeScript is not the only way in. A selection built from
 * JSON, from a config file, from a JavaScript call site, or from an object spread that dropped a
 * [field]" reaches the same place. The reading API was fixed for it in 0.6.79, and
 * `readEnvelopeAtResolution` — the sibling that sweep did not list — in 0.6.98.
 *
 * `filterAnnotationsByTime` is the one function left in the package that takes a window object,
 * and it was never in either sweep because it is in `annotations-query.ts` rather than on the
 * reading surface. It read `window.startSeconds` on its second line, so an omitted window came
 * back as V8's `TypeError: Cannot read properties of undefined (reading 'startSeconds')` — a
 * `TypeError` naming an internal field rather than the argument, with no `Next:` clause.
 *
 * The near miss is what makes it worth a guard rather than a shrug: pass `{}` instead of nothing
 * and the seconds check catches it, so the quality of the message depended on whether the object
 * was empty or absent.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { isEdfError } from '../../src/errors.js';

const call =
  (window: unknown): (() => unknown) =>
  () =>
    (filterAnnotationsByTime as unknown as (a: readonly never[], w: unknown) => unknown)(
      [],
      window,
    );

describe('filterAnnotationsByTime with no window', () => {
  it('throws a RangeError rather than a TypeError', () => {
    expect(call(undefined)).toThrow(RangeError);
    expect(call(undefined)).not.toThrow(TypeError);
  });

  it('is a caller mistake, so isEdfError says false', () => {
    let thrown: unknown;
    try {
      call(undefined)();
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call, the argument and what to pass', () => {
    expect(call(undefined)).toThrow(
      /^filterAnnotationsByTime\(\): the window is undefined, not an object\. Next: pass a window carrying startSeconds and durationSeconds\.$/,
    );
  });

  it('says nothing about the field it happened to read first', () => {
    expect(call(undefined)).not.toThrow(/Cannot read properties|startSeconds must be/);
  });

  it('names null as itself, the way a config file produces it', () => {
    expect(call(null)).toThrow(/the window is null, not an object/);
  });

  it('leaves the empty object to the seconds check, which already named it', () => {
    expect(call({})).toThrow(/window\.startSeconds must be a finite number of seconds/);
  });
});
