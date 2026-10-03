/**
 * The typed payloads a consumer branches on, checked by the compiler.
 *
 * `errors.ts` carries these fields so a handler can act on an error rather than read it, and three
 * of them had been told something the runtime does not honour. 0.6.277 and 0.6.278 fixed the two
 * that are counts by putting numbers in them. `EdfChannelNotFoundError.selector` is the third, and
 * the fix there is the type: it holds `undefined` whenever the refused selector was neither a label,
 * an index, nor a signal carrying one — a BigInt index, a plain object, `null` — and it was cast to
 * `string | number` anyway.
 *
 * A type-only file. It asserts by compiling, which is the only way to pin this one: the runtime
 * value was already `undefined`, so nothing observable changed. What changed is that a consumer's
 * `typeof selector === 'number' ? byIndex : byLabel` no longer type-checks without handling the
 * third case, which is the whole point — `concepts.md` says the same of `sampleRateHz`:
 * "`strictNullChecks` makes you handle it".
 *
 * The two count payloads are asserted here too, so a later change cannot quietly widen them back
 * into something a handler has to narrow before doing arithmetic.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { EdfChannelNotFoundError, EdfRangeError, EdfSourceError } from '../../src/errors.js';
import type { RecordRange } from '../../src/types.js';

describe('EdfChannelNotFoundError.selector', () => {
  it('admits the absent case the runtime produces', () => {
    expectTypeOf<EdfChannelNotFoundError['selector']>().toEqualTypeOf<
      string | number | undefined
    >();
  });

  it('is therefore not assignable to a label-or-index without a check', () => {
    expectTypeOf<EdfChannelNotFoundError['selector']>().not.toEqualTypeOf<string | number>();
  });

  it('still names the labels as a plain array of strings', () => {
    expectTypeOf<EdfChannelNotFoundError['availableLabels']>().toEqualTypeOf<readonly string[]>();
  });
});

describe('the two payloads that are counts', () => {
  it('stay numbers, so a handler can add them', () => {
    expectTypeOf<EdfSourceError['offset']>().toEqualTypeOf<number>();
    expectTypeOf<EdfSourceError['requestedLength']>().toEqualTypeOf<number>();
    expectTypeOf<EdfRangeError['requested']>().toEqualTypeOf<RecordRange>();
    expectTypeOf<EdfRangeError['available']>().toEqualTypeOf<RecordRange>();
  });

  it('keep the one field that is genuinely optional optional', () => {
    expectTypeOf<EdfSourceError['receivedLength']>().toEqualTypeOf<number | undefined>();
  });
});
