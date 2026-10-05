/**
 * The site the realm sweep missed, because it was not spelled `instanceof`.
 *
 * 0.6.284, 0.6.285 and 0.6.286 took `instanceof` out of the three places that still decided
 * something with it, and the rule they applied is stated in six modules: a class identity is false
 * across a realm boundary — an iframe, a worker, an Electron contextBridge, jsdom, a Node `vm`
 * context. `grep instanceof` found those three and not this one, which compares a PROTOTYPE:
 *
 *     if (values.length === 0 && Object.getPrototypeOf(headers) === Object.prototype) return;
 *
 * `Object.prototype` is this realm's, so a `{}` built in another one failed it exactly as
 * `instanceof Object` would — and was then refused by a sentence about a string becoming one header
 * per character and a Map becoming nothing at all, for the one empty object 0.6.276 wrote that arm
 * to accept, "because it is what `undefined` already means". `headers: config.headers ?? {}` is the
 * spelling that gets there.
 *
 * The built-in tag is not the fix here, which is why this is not a copy of 0.6.284.
 * `Object.prototype.toString.call` answers `[object Object]` for a class instance too, and refusing
 * those is this arm's entire purpose: a token behind a prototype getter has no own enumerable values,
 * so it spreads to `{}` and the request goes out anonymously — "which 0.6.250 calls the worse case".
 * The PROTOTYPE CHAIN separates them. A plain object's prototype is some realm's `Object.prototype`,
 * whose own prototype is `null`; a class instance's is `X.prototype`, whose prototype is not.
 *
 * `Object.create(null)` comes along with it, and is a header bag a caller may reasonably build: no
 * prototype at all, and it spreads exactly like `{}`. It was refused before (0.6.292).
 */

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';

/** A server that answers the one HEAD-like probe `httpSource` makes at construction. */
const ok = (async () =>
  new Response(null, {
    status: 200,
    headers: { 'accept-ranges': 'bytes', 'content-length': '512' },
  })) as unknown as typeof fetch;

const build = async (headers: unknown): Promise<unknown> =>
  Promise.resolve()
    .then(() =>
      httpSource('https://example.test/f.edf', { headers: headers as never, fetch: ok as never }),
    )
    .then(
      () => undefined,
      (error: unknown) => error,
    );

/** No own enumerable properties at all: the credential lives only on the prototype. */
class GetterOnly {
  get authorization(): string {
    return 'Bearer secret';
  }
}

describe('an empty header bag from another realm', () => {
  it('fails the identity the guard used, and passes the chain it uses now', () => {
    const other = runInNewContext('({})') as object;
    // The premise. If this ever becomes true, these tests are checking nothing.
    expect(Object.getPrototypeOf(other) === Object.prototype).toBe(false);
    expect(Object.getPrototypeOf(Object.getPrototypeOf(other) as object)).toBeNull();
    // And the shape this arm exists to refuse is still told apart by it.
    expect(Object.getPrototypeOf(Object.getPrototypeOf(new GetterOnly()) as object)).not.toBeNull();
  });

  it('is accepted, as the same object built in this realm always was', async () => {
    expect(await build(runInNewContext('({})'))).toBeUndefined();
    expect(await build({})).toBeUndefined();
  });

  it('is accepted with headers on it too, which never depended on the prototype', async () => {
    expect(await build(runInNewContext('({ authorization: "Bearer x" })'))).toBeUndefined();
  });

  it('accepts Object.create(null), which spreads exactly like {}', async () => {
    expect(await build(Object.create(null))).toBeUndefined();
    expect(
      await build(Object.assign(Object.create(null) as object, { authorization: 'Bearer x' })),
    ).toBeUndefined();
    expect(await build(Object.freeze({}))).toBeUndefined();
  });

  it('still refuses a credential behind a prototype getter, which is the point of this arm', async () => {
    const instance = new GetterOnly();
    // It would spread to nothing, so the request would go out with no authorization at all.
    expect(Object.values(instance as object)).toEqual([]);
    expect({ ...(instance as object) }).toEqual({});
    const thrown = await build(instance);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/not a plain object of header names/);
  });

  it('still refuses the containers that spread to nothing', async () => {
    for (const [what, headers] of [
      ['a Map', new Map()],
      ['a Headers', new Headers()],
      ['a Map with entries', new Map([['authorization', 'Bearer x']])],
      ['an array of pairs', [['authorization', 'Bearer x']]],
      ['a string', 'authorization: Bearer x'],
    ] as ReadonlyArray<readonly [string, unknown]>) {
      const thrown = await build(headers);
      expect(thrown, what).toBeInstanceOf(Error);
      expect((thrown as Error).message, what).toMatch(/Object\.fromEntries\(headers\)/);
    }
  });

  it('still names a pending Promise, which 0.6.263 added', async () => {
    const thrown = await build(Promise.resolve({}));
    expect((thrown as Error).message).toMatch(/options\.headers is a pending Promise/);
  });
});
