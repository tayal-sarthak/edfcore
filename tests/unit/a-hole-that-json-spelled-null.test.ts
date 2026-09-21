/**
 * `mergeChunks` given an array with a `null` in it.
 *
 * Every wrong element in that array had a sentence: `undefined` is "no chunk at 0", a number, a
 * string and an object are "the value at 0 is …, not a chunk", and one signal of a chunk is named
 * as that. `null` reached `chunk.records` on the shape check and threw V8's `Cannot read properties
 * of null (reading 'records')` — the one value in this array that left the package with no `Next:`
 * clause, from a package where `next-clause.test.ts` proves every composed message has one.
 *
 * It is also how a hole actually arrives. The advice already says "with no holes and nothing
 * spliced out of it", and the transport that makes one spells it `null`: `JSON.stringify` writes an
 * absent element as `null`, so a chunk array that crossed a worker boundary, a cache or a message
 * channel comes back with `null` where nothing was. `a-selection-from-json.test.ts` follows that
 * route for the selection and `design-decisions.md` follows it for a chunk.
 *
 * Same sentence as `undefined`, because it is the same mistake, with the spelling named.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function chunks(): Promise<readonly EdfChunk[]> {
  const recording = await openEdf(byteSource(FILE));
  return readWindow(recording, { signalIndices: [0], startSeconds: 0, durationSeconds: 3 });
}

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('a null element', () => {
  it.each([
    ['alone', 0],
    ['after a real chunk', 1],
  ])('no longer throws the engine TypeError, %s', async (_where, index) => {
    const list = await chunks();
    const given = index === 0 ? [null] : [list[0], null];
    const thrown = refusal(() => mergeChunks(given as never));
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown.message).not.toContain('Cannot read properties');
    expect(thrown.message).toContain(`no chunk at ${index}`);
    expect(thrown.message).toContain('Next:');
  });

  it('is answered exactly as an undefined element is, minus the spelling', async () => {
    const list = await chunks();
    const asNull = refusal(() => mergeChunks([list[0], null] as never));
    const asUndefined = refusal(() => mergeChunks([list[0], undefined] as never));
    expect(asNull.message).toBe(asUndefined.message);
  });

  it('names JSON as what spells a hole that way', async () => {
    const thrown = refusal(() => mergeChunks([null] as never));
    expect(thrown.message).toContain('JSON writes one as null');
  });

  it('stays a RangeError, as every refusal from this module is', async () => {
    const thrown = refusal(() => mergeChunks([null] as never));
    expect(thrown).toBeInstanceOf(RangeError);
  });
});

describe('the route that produces one', () => {
  it('is real: JSON writes an absent element as null', () => {
    // Not the chunk itself — a chunk carries bigint ticks, which `JSON.stringify` refuses outright.
    // What travels is whatever a worker chose to send, and a hole in it arrives spelled this way.
    const parsed = JSON.parse(JSON.stringify([{ records: {} }, undefined])) as unknown[];
    expect(parsed[1]).toBeNull();
    const thrown = refusal(() => mergeChunks(parsed as never));
    expect(thrown.message).toContain('no chunk at 1');
  });
});

describe('every other element keeps the sentence it had', () => {
  it.each([
    ['undefined', undefined, 'no chunk at 0'],
    ['a number', 0, 'the value at 0 is 0, not a chunk'],
    ['a string', 'x', 'the value at 0 is the string "x", not a chunk'],
    ['an empty object', {}, 'the value at 0 is an object, not a chunk'],
  ])('refuses %s the way it always did', (_shape, value, expected) => {
    const thrown = refusal(() => mergeChunks([value] as never));
    expect(thrown.message).toContain(expected);
  });

  it('still names one signal of a chunk as that', async () => {
    const list = await chunks();
    const thrown = refusal(() => mergeChunks(list[0]?.signals as never));
    expect(thrown.message).toContain('one signal of a chunk rather than a chunk');
  });

  it('still merges the chunks readWindow returned', async () => {
    const list = await chunks();
    expect(mergeChunks(list).signals).toHaveLength(1);
  });
});
