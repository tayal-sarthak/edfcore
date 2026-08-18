/**
 * The network trap is armed.
 *
 * `tests/support/offline.ts` replaces `globalThis.fetch` through `setupFiles`, and a setup file
 * that failed to load — renamed, dropped from the config, a typo in the path — would leave every
 * other test passing with nothing to show that anything was ever guarded. So the trap is called
 * here, once, and has to bite.
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';

describe('the suite cannot reach the network', () => {
  it('refuses a call to the ambient fetch', async () => {
    await expect(fetch('https://example.invalid/study.edf')).rejects.toThrow(/offline by design/);
  });

  it('says what to do instead, the way every other refusal here does', async () => {
    await expect(fetch('https://example.invalid/study.edf')).rejects.toThrow(/Next:/);
  });

  it('takes httpSource down with it when no fetch is injected', async () => {
    /*
     * The route that matters. `httpSource` falls back to `globalThis.fetch`, which is right for a
     * consumer and is how a test reaches the network by forgetting an option rather than by
     * deciding to. With the trap armed, forgetting it fails loudly instead.
     */
    // `httpSource` resolves the length before it hands back a source, so the refusal arrives at
    // construction rather than at the first read.
    await expect(httpSource('https://example.invalid/study.edf')).rejects.toThrow(
      /offline by design/,
    );
  });

  it('leaves an injected fetch alone', async () => {
    // The trap is on the fallback, not on the feature: a supplied implementation still runs.
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source = await httpSource('https://example.invalid/study.edf', {
      byteLength: bytes.length,
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 206,
          headers: { get: () => null },
          arrayBuffer: () => Promise.resolve(bytes.buffer as ArrayBuffer),
        }),
    });
    await expect(source.read(0, 4)).resolves.toEqual(bytes);
  });
});
