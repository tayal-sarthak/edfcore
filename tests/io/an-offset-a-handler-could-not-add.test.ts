/**
 * `EdfSourceError.offset` and `requestedLength`, when the read that was refused was not made of
 * numbers.
 *
 * 0.6.277 closed this on `EdfRangeError`'s pair. These three fields are declared `number` too, and
 * the guards that build this error hand over the value they refused. `ByteSource.read` is the one
 * that reaches it: its refusal says the argument "is not a non-negative safe integer" — and then put
 * the string `'0'` or the BigInt `0n` on `offset`.
 *
 * `a-request-that-went-out-on-the-global-fetch.test.ts` calls these "the fields an EdfSourceError
 * handler branches on", and a handler adding `offset + requestedLength` to retry at the next block
 * got `'04'`, or V8's "Cannot mix BigInt and other types".
 *
 * `receivedLength` keeps `undefined`, which is a declared value for it rather than a stand-in: it
 * means no read completed, which is a different fact from a read that returned an unusable count.
 *
 * Every real read is unchanged — an out-of-range request still reports the offset and length it
 * asked for, because those were numbers.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();
const source = () => byteSource(bytes);

const refusal = async (call: () => unknown): Promise<EdfSourceError> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeInstanceOf(EdfSourceError);
  return thrown as EdfSourceError;
};

type Read = (offset: unknown, length: unknown) => Promise<unknown>;

const WRONG: ReadonlyArray<readonly [string, unknown, unknown]> = [
  ['a string offset', '0', 4],
  ['a string length', 0, '4'],
  ['a BigInt offset', 0n, 4],
  ['a BigInt length', 0, 4n],
  ['both as strings', '0', '4'],
  ['an undefined offset', undefined, 4],
];

describe.each(WRONG)('a read given %s', (_name, offset, length) => {
  it('puts numbers on the payload', async () => {
    const read = source().read as unknown as Read;
    const error = await refusal(() => read(offset, length));
    expect(typeof error.offset).toBe('number');
    expect(typeof error.requestedLength).toBe('number');
  });

  it('is a payload a handler can add without throwing', async () => {
    const read = source().read as unknown as Read;
    const error = await refusal(() => read(offset, length));
    const next = error.offset + error.requestedLength;
    expect(typeof next).toBe('number');
  });

  it('still names the value the caller wrote, in the message', async () => {
    const read = source().read as unknown as Read;
    const error = await refusal(() => read(offset, length));
    expect(error.message).toContain('ByteSource.read was given');
  });
});

describe('receivedLength', () => {
  it('stays undefined when no read completed, which is its own fact', async () => {
    const read = source().read as unknown as Read;
    const error = await refusal(() => read('0', 4));
    expect(error.receivedLength).toBeUndefined();
  });
});

describe('a read whose arguments were numbers all along', () => {
  it('reports exactly what it asked for', async () => {
    const error = await refusal(() => source().read(1e9, 4));
    expect(error.offset).toBe(1e9);
    expect(error.requestedLength).toBe(4);
  });

  it('and a read in range still returns its bytes', async () => {
    const got = await source().read(8, 16);
    expect([...got]).toEqual([...bytes.slice(8, 24)]);
  });
});
