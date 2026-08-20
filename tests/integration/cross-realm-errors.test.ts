/**
 * `isEdfError` survives a realm boundary and `instanceof` does not, executed.
 *
 * This is the reason `edfErrorKind` exists at all. `src/errors.ts` states it, `api-errors.md`
 * repeats it — "`instanceof` compares constructor identity, and constructor identity is
 * per-realm" — and `public-api.test.ts` lists `isEdfError` under a heading that calls it the
 * cross-realm discriminator. None of them showed it happening. An API shaped entirely around a
 * property nobody demonstrated is an API shaped around a belief.
 *
 * Two copies of the module rather than a `vm` realm, because two copies is the case that actually
 * reaches people: an iframe, a worker, or — most often — one dependency tree resolving edfcore
 * twice, which npm does whenever two packages want incompatible ranges. A second import under a
 * distinct URL gives a second set of classes with the same names and different identities, which
 * is exactly what that dependency tree produces.
 *
 * The consequence is the part worth pinning: `catch (error) { if (error instanceof EdfError) }`
 * silently stops matching, so a consumer's error handling falls through to a rethrow on errors it
 * was written to handle — and nothing about it looks broken.
 */

import { describe, expect, it } from 'vitest';

/** A second, independent copy of the error module — the shape a duplicated install has. */
const OTHER = (await import(
  `${new URL('../../src/errors.js', import.meta.url).href}?copy=1`
)) as typeof import('../../src/errors.js');

const MINE = await import('../../src/errors.js');

/** One error built by the OTHER copy, with the fields its constructor requires. */
const foreignError = (): InstanceType<typeof OTHER.EdfSourceError> =>
  new OTHER.EdfSourceError('a read failed. Next: retry.', { offset: 0, requestedLength: 16 });

describe('the two copies really are two', () => {
  it('exports classes of the same name and different identity', () => {
    expect(OTHER.EdfSourceError.name).toBe(MINE.EdfSourceError.name);
    // Without this the assertions below would pass on one module imported twice from cache.
    expect(OTHER.EdfSourceError).not.toBe(MINE.EdfSourceError);
  });
});

describe('instanceof does not cross the boundary', () => {
  it('fails for an error the other copy threw', () => {
    const foreign = foreignError();
    expect(foreign instanceof MINE.EdfSourceError).toBe(false);
    expect(foreign instanceof MINE.EdfError).toBe(false);
  });

  it('still works within one copy, which is what makes the failure invisible', () => {
    // The trap: every test a consumer writes against their own copy passes.
    const local = new MINE.EdfSourceError('a read failed. Next: retry.', {
      offset: 0,
      requestedLength: 16,
    });
    expect(local instanceof MINE.EdfError).toBe(true);
  });
});

describe('isEdfError does', () => {
  it('recognises an error from the other copy', () => {
    const foreign = foreignError();
    expect(MINE.isEdfError(foreign)).toBe(true);
  });

  it('carries the discriminator across, so a switch still branches', () => {
    const foreign = foreignError();
    expect(MINE.isEdfError(foreign) && foreign.edfErrorKind).toBe('source');
  });

  it('refuses an ordinary error, so it is a test rather than a rubber stamp', () => {
    expect(MINE.isEdfError(new Error('nope'))).toBe(false);
    expect(MINE.isEdfError(new TypeError('nope'))).toBe(false);
    expect(MINE.isEdfError(null)).toBe(false);
    expect(MINE.isEdfError('EdfSourceError')).toBe(false);
  });

  it('accepts a plain object carrying the discriminator, and that is the design', () => {
    /*
     * It is a duck type — a string `edfErrorKind` and nothing more — which is precisely what
     * makes it work across a boundary. Tightening it to `instanceof Error` would put the problem
     * back: `Error` identity is per-realm too, so the check would start failing on exactly the
     * foreign errors it exists to recognise.
     *
     * The cost is that anything shaped like one passes. That is the right trade for a guard whose
     * job is telling an edfcore error from someone else's, rather than defending against a value
     * built to impersonate one.
     */
    expect(MINE.isEdfError({ edfErrorKind: 'source' })).toBe(true);
    expect(MINE.isEdfError({ edfErrorKind: 42 })).toBe(false);
    expect(MINE.isEdfError({})).toBe(false);
  });
});
