/**
 * What `ByteSource.read` says about an offset or a length it will not accept.
 *
 * Both refusals interpolated the value directly, and a string interpolates as its digits. So a
 * `'0'` — out of a query parameter, a JSON range, a config key, anywhere a number arrives as text
 * — came back as "ByteSource.read was given offset 0, which is not a non-negative safe integer",
 * naming a rule that 0 satisfies, about the first byte of the file. A reader has nothing in the
 * message to work from: the value printed is a perfectly good offset.
 *
 * This is the same defect 0.6.114 fixed for `maxMaterializeBytes` ("must be a finite number, but
 * was 1e9", which is a finite number) and 0.6.131 for a record index. Offset and length are the
 * two numbers every read in the package passes through, so they are the pair most likely to arrive
 * from outside a TypeScript call site.
 *
 * Every numeric refusal is unchanged, because for those the sentence was already true.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';

const source = byteSource(new Uint8Array(64));
const read = (offset: unknown, length: unknown): Promise<unknown> =>
  (source.read as unknown as (o: unknown, l: unknown) => Promise<unknown>)(offset, length);

async function thrownBy(offset: unknown, length: unknown): Promise<Error> {
  try {
    await read(offset, length);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the read was accepted');
}

describe('an offset that arrived as text', () => {
  it('is not described as the number its digits spell', async () => {
    expect((await thrownBy('0', 10)).message).not.toContain('was given offset 0');
  });

  it('is named as the string it is', async () => {
    expect((await thrownBy('0', 10)).message).toContain(
      'ByteSource.read was given the string "0" as its offset',
    );
  });

  it('still says the rule and what to pass', async () => {
    const { message } = await thrownBy('0', 10);
    expect(message).toContain('which is not a non-negative safe integer');
    expect(message).toContain('Next: pass a plain integer byte offset');
  });

  it('is still an EdfSourceError, which is what a read refusal has always been', async () => {
    expect(isEdfError(await thrownBy('0', 10))).toBe(true);
  });
});

describe('a length that arrived as text', () => {
  it('is named as the string it is, in the sibling message', async () => {
    const { message } = await thrownBy(0, '10');
    expect(message).toContain('ByteSource.read was given the string "10" as its length');
    expect(message).not.toContain('was given length 10');
    expect(message).toContain('Next: pass a plain integer byte count');
  });
});

describe('the numeric refusals, which were already true', () => {
  it.each([
    [-1, 10, 'was given -1 as its offset'],
    [1.5, 10, 'was given 1.5 as its offset'],
    [Number.NaN, 10, 'was given NaN as its offset'],
    [0, -1, 'was given -1 as its length'],
    [0, 1.5, 'was given 1.5 as its length'],
  ])('read(%s, %s) still names the number', async (offset, length, expected) => {
    expect((await thrownBy(offset, length)).message).toContain(expected);
  });

  it('leaves a range that is merely too long to the check below them', async () => {
    expect((await thrownBy(0, 1000)).message).toContain('past the end of a 64-byte source');
  });
});
