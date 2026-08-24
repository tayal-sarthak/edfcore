/**
 * A `Content-Range` edfcore cannot read is not a `Content-Range` edfcore disbelieves.
 *
 * On a 206 the header is checked against the range that was asked for, because `assertExactRead`
 * is a LENGTH guard and cannot see a right-sized body taken from the wrong offset — which is what
 * a cache keyed on the URL alone returns. That check is well covered when the header parses.
 *
 * What it does when the header does NOT parse was not. `rangeFromContentRange` returns `undefined`
 * for anything outside `bytes <first>-<last>/`, and `undefined` is documented as "no usable claim"
 * rather than "the claim was wrong": a `FetchLike` double is free to answer every header with
 * `null`, and a real server may answer in a range unit of its own, which RFC 7233 permits. Every
 * existing case supplies a well-formed header or none at all, so the two `return undefined` lines
 * in the middle had never run, and turning either into a refusal would have rejected reads that
 * are fine.
 *
 * Four shapes reach them, and all four appear in the wild: a unit that is not `bytes`, the
 * unsatisfiable `bytes *\/total` form, a header truncated before the total, and byte positions
 * past 2^53 from a proxy fronting an object store that counts in something else.
 *
 * The non-vacuous half is asserted first and last: a header that DOES parse and names a different
 * part of the resource is still refused, so "unreadable" has not quietly become "unchecked".
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.edf';
const SIZE = 4096;
const BODY = new Uint8Array(SIZE).map((_, at) => at & 0xff);

/** A range server whose `Content-Range` is whatever the case says, body always correct. */
function answering(contentRange: (first: number, last: number) => string | null): FetchLike {
  return ((_href: string, init?: { method?: string; headers?: Record<string, string> }) => {
    if ((init?.method ?? 'GET') === 'HEAD') {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (/content-length/i.test(name) ? String(SIZE) : null) },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as HttpResponseLike);
    }
    const asked = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? init?.headers?.range ?? '');
    const first = Number(asked?.[1] ?? 0);
    const last = Number(asked?.[2] ?? SIZE - 1);
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: {
        get: (name: string) => (/content-range/i.test(name) ? contentRange(first, last) : null),
      },
      arrayBuffer: () => Promise.resolve(BODY.slice(first, last + 1).buffer),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
}

async function readsCleanly(contentRange: (first: number, last: number) => string | null) {
  const source = await httpSource(HREF, { fetch: answering(contentRange) });
  const bytes = await source.read(64, 32);
  expect([...bytes]).toEqual([...BODY.subarray(64, 96)]);
}

describe('a Content-Range edfcore can read', () => {
  it('is believed when it agrees', async () => {
    await readsCleanly((first, last) => `bytes ${first}-${last}/${SIZE}`);
  });

  it('is refused when it names a different part of the resource', async () => {
    // The anchor for everything below: a parseable header is still checked, so the cases that
    // follow are about unreadable headers rather than about a check that stopped running.
    const source = await httpSource(HREF, {
      fetch: answering((_first, last) => `bytes 1024-${1024 + last - 64}/${SIZE}`),
    });
    const error = await source.read(64, 32).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(EdfSourceError);
    expect((error as EdfSourceError).message).toContain('it sent bytes 1024..1055');
  });
});

describe('a Content-Range edfcore cannot read', () => {
  it.each([
    ['a range unit that is not bytes', (f: number, l: number) => `items ${f}-${l}/${SIZE}`],
    ['the unsatisfiable star form', () => `bytes */${SIZE}`],
    ['a header truncated before the total', (f: number, l: number) => `bytes ${f}-${l}`],
    ['a first-byte-pos past 2^53', () => `bytes 9007199254740993-9007199254740999/${SIZE}`],
    ['nothing at all', () => null],
  ])('is treated as no claim, and the read proceeds: %s', async (_name, header) => {
    await readsCleanly(header);
  });

  it('is not a claim in either direction, so a wrong body is still caught by length', async () => {
    // The length guard is the one that stays, and it must: without a readable Content-Range it is
    // all that stands between a caller and a short body. A header nobody can parse does not
    // disable it.
    const short = ((_href: string, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: (name: string) => (/content-length/i.test(name) ? String(SIZE) : null) },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        } as unknown as HttpResponseLike);
      }
      return Promise.resolve({
        ok: true,
        status: 206,
        headers: { get: () => 'items 64-95/4096' },
        arrayBuffer: () => Promise.resolve(BODY.slice(64, 90).buffer),
      } as unknown as HttpResponseLike);
    }) as unknown as FetchLike;

    const source = await httpSource(HREF, { fetch: short });
    await expect(source.read(64, 32)).rejects.toBeInstanceOf(EdfSourceError);
  });
});
