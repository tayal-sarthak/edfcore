/**
 * What `byteSource` accepts, and what it says about everything else.
 *
 * It is the first call almost everyone makes and the one place a caller's mistake can be
 * mistaken for a defect in their file. `new Uint8Array(x)` accepts almost anything — a string, a
 * plain object and `null` all yield an empty array, and a `number[]` yields one of the wrong
 * length — so a source built from any of them reads back as `[SOURCE_TOO_SMALL] the header is 0
 * bytes`, blaming the recording for an argument. That is why the check is at construction, and
 * why the message names what arrived rather than only what was wanted.
 *
 * Two acceptances are load-bearing and neither is obvious from the signature:
 *
 *  - A **Node `Buffer`** works, because it is a `Uint8Array`. `await readFile(path)` is the most
 *    common way anyone in Node gets bytes, and it is what the message tells them to pass.
 *  - A **`SharedArrayBuffer`** works, and so does a buffer or a view from another realm. The
 *    guard is `Object.prototype.toString`, not `instanceof`: a tag comes from the prototype's
 *    `Symbol.toStringTag` and every realm agrees on it, while `instanceof ArrayBuffer` is false
 *    across an iframe, an Electron contextBridge, jsdom or a Node `vm` context. Until 0.3.20 the
 *    ArrayBuffer half of the guard used `instanceof` while the SharedArrayBuffer half already
 *    used the tag, so a real, fully usable ArrayBuffer from another realm was refused as "a plain
 *    object" and told to "pass the ArrayBuffer itself" — which is what the caller had done.
 *
 * Two refusals are load-bearing too. An **`Int8Array`** has one byte per element, so it passes
 * every length check and then has its already-signed elements sign-extended a second time during
 * decode: fabricated microvolts with no error anywhere. A **`DataView`** is the other shape that
 * looks like bytes and is not.
 *
 * The realm case is exercised through `node:vm` rather than described, because a same-realm
 * buffer passes `instanceof` and would let the old defect back in unnoticed.
 */

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';

const refusal = (value: unknown): EdfSourceError | undefined => {
  try {
    byteSource(value as never);
    return undefined;
  } catch (thrown) {
    return thrown as EdfSourceError;
  }
};

describe('the shapes that are bytes', () => {
  it.each([
    ['an ArrayBuffer', () => new ArrayBuffer(8)],
    ['a Uint8Array', () => new Uint8Array(8)],
    ['a Node Buffer, which is what readFile returns', () => Buffer.alloc(8)],
    ['a SharedArrayBuffer', () => new SharedArrayBuffer(8)],
  ])('accepts %s, reporting its length', (_what, make) => {
    expect(byteSource(make() as never).byteLength).toBe(8);
  });

  it('respects a view over part of a larger buffer', async () => {
    // The subarray arithmetic is the view's, not this module's: a caller who sliced a big
    // download to one file's bytes must not have the offset applied twice.
    const whole = Uint8Array.from({ length: 16 }, (_, at) => at);
    const source = byteSource(whole.subarray(4, 12));
    expect(source.byteLength).toBe(8);
    expect([...(await source.read(0, 3))]).toEqual([4, 5, 6]);
  });

  it.each([
    ['an ArrayBuffer', 'new ArrayBuffer(8)'],
    ['a Uint8Array', 'new Uint8Array(8)'],
  ])('accepts %s built in another realm, where instanceof is false', (_what, expression) => {
    const foreign = runInNewContext(expression) as object;
    // The premise: this really did cross a realm boundary.
    expect(foreign instanceof ArrayBuffer || foreign instanceof Uint8Array).toBe(false);
    expect(byteSource(foreign as never).byteLength).toBe(8);
  });
});

describe('the shapes that are not', () => {
  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string', 'hello', 'a string'],
    ['a number', 42, 'a number'],
    ['a plain object', { length: 3 }, 'a plain object'],
    ['a number array', [1, 2, 3], 'a plain Array'],
    ['an Int8Array', new Int8Array(8), 'Int8Array'],
    ['an Int16Array', new Int16Array(8), 'Int16Array'],
    ['a DataView', new DataView(new ArrayBuffer(8)), 'DataView'],
  ])('refuses %s, naming what arrived', (_what, value, named) => {
    const failure = refusal(value);
    expect(failure).toBeInstanceOf(EdfSourceError);
    expect(failure?.message).toContain(`received ${named}`);
    // Never the value itself: it could be anything, including something enormous.
    expect(failure?.message).not.toContain('hello');
  });

  it('tells an Int8Array caller why, since its length would have passed', () => {
    // The one refusal whose reason is not "this is not bytes" — it is bytes, of the wrong sign.
    expect(refusal(new Int8Array(8))?.message).toContain('one byte per element');
    expect(refusal(new Int8Array(8))?.message).toContain('fabricated sample values');
  });

  it('names the three ways to get bytes, so the message is a fix and not a complaint', () => {
    const message = refusal(null)?.message ?? '';
    expect(message).toContain('new Uint8Array(await blob.arrayBuffer())');
    expect(message).toContain('await readFile(path)');
    expect(message).toContain('the ArrayBuffer itself');
  });

  it('refuses at construction, so no read can blame the file', () => {
    // The failure this exists to prevent: a source built from a string reports a zero-byte
    // header, which reads as a truncated recording rather than as a wrong argument.
    expect(refusal('not bytes')).toBeInstanceOf(EdfSourceError);
    expect(refusal('not bytes')?.message).not.toContain('SOURCE_TOO_SMALL');
  });
});
