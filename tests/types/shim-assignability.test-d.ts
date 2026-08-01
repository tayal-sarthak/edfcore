/// <reference types="node" />

/**
 * The published `.d.ts` must not depend on the DOM or on `@types/node`, so `src/types.ts`
 * declares structural stand-ins for the few platform types edfcore touches. That only works
 * if the *real* types stay assignable to them — and nothing in the library itself would
 * notice if they drifted, because the library never sees the real ones.
 *
 * This file is that guard. It is compiled against DOM + `@types/node` (unlike `src/`, which
 * builds with `lib: ["ES2022"]` and `types: []`), and it fails the build rather than at
 * runtime. It exercises the two traps that have actually bitten this design:
 *
 *   1. `FetchLike` naming `signal` in its `init` type, which makes `globalThis.fetch`
 *      unassignable by parameter contravariance.
 *   2. `FileHandleLike.read` drifting from the real positional `FileHandle.read` overload.
 *
 * It contains no assertions to run — if it compiles, the contract holds. Vitest still
 * collects it, so the one runtime test below keeps the file from looking empty in a report.
 */

import type { FileHandle } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { FileHandleLike } from '../../src/node.js';
import type {
  AbortSignalLike,
  BlobLike,
  ByteSource,
  FetchLike,
  HttpResponseLike,
} from '../../src/types.js';

/**
 * Compile-time assertion: `Actual` must be assignable to `Expected`.
 *
 * Purely type-level — it emits nothing, so there is no runtime reference to a platform value
 * that may not exist in the test environment.
 */
type AssertAssignable<Expected, Actual extends Expected> = Actual;

// --- DOM ------------------------------------------------------------------

export type BlobIsAssignable = AssertAssignable<BlobLike, Blob>;
export type FileIsAssignable = AssertAssignable<BlobLike, File>;
export type AbortSignalIsAssignable = AssertAssignable<AbortSignalLike, AbortSignal>;
export type ResponseIsAssignable = AssertAssignable<HttpResponseLike, Response>;

// The one that broke a design proposal: a `FetchLike` naming `signal` in its `init` type
// rejects `globalThis.fetch` outright, because parameters are checked contravariantly.
// Writing the function rather than casting is the point — a cast would hide the failure.
const realFetchIsAssignable: FetchLike = (url, init) => fetch(url, init);
void realFetchIsAssignable;

// --- Node -----------------------------------------------------------------

export type FileHandleIsAssignable = AssertAssignable<FileHandleLike, FileHandle>;

// --- edfcore's own contract ------------------------------------------------

// A hand-written source needs nothing beyond the two required members.
const minimalSource: ByteSource = {
  byteLength: 0,
  read: async (_offset: number, length: number) => new Uint8Array(length),
};
void minimalSource;

describe('platform shim assignability', () => {
  it('is enforced by compilation, not by this assertion', () => {
    // `npm run typecheck` compiles this file with DOM and @types/node available. If a shim
    // drifts from the real platform type, that command fails and this test never runs.
    expect(minimalSource.byteLength).toBe(0);
  });
});
