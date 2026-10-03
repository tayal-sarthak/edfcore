/**
 * A buffer `byteSource` accepts, named as one.
 *
 * `io/bytes.ts` states the rule and the failure in the same docblock: "A tag comes from
 * `Symbol.toStringTag` on the buffer prototype and every realm agrees on it; `instanceof
 * ArrayBuffer` is false for a buffer that crossed a realm boundary — an iframe, an Electron
 * contextBridge, jsdom, a Node `vm` context." Until 0.3.20 its own guard said `instanceof`, so
 * "a real, fully usable ArrayBuffer from another realm was refused as 'a plain object' and told to
 * 'pass the ArrayBuffer itself' — which is what the caller had done".
 *
 * 0.6.116 gave the package a shared describer and wrote the same rule into it — "The tag, not
 * `instanceof`: it is the same across realms, which is why `io/bytes.ts` uses it too" — three lines
 * above a branch that said `instanceof`. 0.3.20's fix never reached it.
 *
 * So the two halves disagreed about what an ArrayBuffer is. `byteSource(buffer)` takes one from any
 * realm, and every guard that reads its subject out of `describeValue` — about forty of them — named
 * that same buffer "an object", while the identical buffer built here was named "ArrayBuffer". The
 * two spellings of one mistake, told apart by which realm the caller's buffer came from, which is
 * the one thing about it they cannot see from the call site (0.6.284).
 *
 * `SharedArrayBuffer` is here because `byteSource`'s `BUFFER_TAGS` admits that tag too, so it is a
 * buffer this package takes and therefore a buffer it has to be able to name.
 *
 * The tags are inlined in `text/describe.ts` rather than imported from `io/bytes.ts`: that module is
 * layer 1 and declares it imports nothing, and `io/` is layer 5.
 */

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../../src/decode/physical.js';
import { parseHeader } from '../../../src/header/parse.js';
import { byteSource } from '../../../src/io/bytes.js';
import { describeValue } from '../../../src/text/describe.js';
import type { EdfSignal } from '../../../src/types.js';
import { minimalEdfPlus } from '../../support/writer.js';

/** A real second realm: `vm` built-ins have their own prototypes, so `instanceof` is false. */
function otherRealm<T>(expression: string): T {
  return runInNewContext(`(${expression})`) as T;
}

const FIXTURE = minimalEdfPlus();
const SIGNAL = parseHeader(FIXTURE, FIXTURE.byteLength).signals[0] as EdfSignal;

describe('describeValue names a buffer from another realm', () => {
  it('is handed a buffer instanceof cannot recognise', () => {
    const buffer = otherRealm<ArrayBuffer>('new ArrayBuffer(8)');
    // The premise. If this ever becomes true, the branch below is testing nothing.
    expect(buffer instanceof ArrayBuffer).toBe(false);
    expect(Object.prototype.toString.call(buffer)).toBe('[object ArrayBuffer]');
  });

  it('names it ArrayBuffer, the same as one built here', () => {
    expect(describeValue(otherRealm<ArrayBuffer>('new ArrayBuffer(8)'))).toBe('ArrayBuffer');
    expect(describeValue(new ArrayBuffer(8))).toBe('ArrayBuffer');
  });

  it('names a SharedArrayBuffer, which byteSource also admits', () => {
    expect(describeValue(new SharedArrayBuffer(8))).toBe('SharedArrayBuffer');
  });

  it('is the buffer byteSource takes, so the refusal must name it', () => {
    const buffer = otherRealm<ArrayBuffer>('new ArrayBuffer(8)');
    // Accepted at the door: `byteSource` has used the tag since 0.3.20.
    expect(byteSource(buffer).byteLength).toBe(8);
    // And named at every guard that refuses one, whichever realm it came from.
    expect(() => toPhysical(SIGNAL, buffer as never)).toThrow(/the samples are ArrayBuffer/);
  });

  it('still names a view from another realm, which ArrayBuffer.isView already caught', () => {
    expect(describeValue(otherRealm<Uint8Array>('new Uint8Array(4)'))).toBe('Uint8Array');
    expect(describeValue(otherRealm<DataView>('new DataView(new ArrayBuffer(4))'))).toBe(
      'DataView',
    );
  });

  it('still answers "an object" for a plain object, which is not a buffer anywhere', () => {
    expect(describeValue({})).toBe('an object');
    expect(describeValue(otherRealm<object>('({ byteLength: 8 })'))).toBe('an object');
  });

  it('still names a RegExp, which now reads the same tag', () => {
    expect(describeValue(/EEG/i)).toBe('the RegExp /EEG/i');
    expect(describeValue(otherRealm<RegExp>('/EEG/i'))).toBe('the RegExp /EEG/i');
  });
});
