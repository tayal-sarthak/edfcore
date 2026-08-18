/**
 * The suite runs with no way out to the network.
 *
 * `tests/README.md` opens with "`git clone && npm test` is green and offline", which is a
 * property of the suite rather than a description of it: every fixture is built in memory, the
 * corpus tests skip when the files are absent, and the `httpSource` tests inject their own
 * `fetch`. Nothing enforced any of that. A test that reached a real host would pass on a laptop,
 * pass in CI, and fail for the one contributor behind a proxy — or worse, quietly depend on a
 * third party staying up.
 *
 * `httpSource()` falls back to `globalThis.fetch` when no implementation is passed, so the
 * fallback is the route by which a test could reach the network without meaning to: forget the
 * `fetch` option and the call silently goes out. That fallback is right for a consumer in a
 * browser and wrong for a test, so the global is replaced here with something that refuses and
 * says what to do instead.
 *
 * Loaded through `setupFiles`, which runs once per test file before any of it, so this is armed
 * for the whole run rather than for whoever remembered to import it. `offline.test.ts` calls it
 * to prove the trap is live, because a setup file that failed to load would leave every test
 * passing and nothing to show for it.
 */

const REFUSAL =
  'A test called globalThis.fetch. The suite is offline by design — `git clone && npm test` has ' +
  'to be green with no network. Next: pass your own implementation, the way the httpSource ' +
  'tests do — `httpSource(url, { fetch })` — rather than relying on the ambient fallback.';

// REJECTS rather than throwing synchronously. A real `fetch` does not throw when a host is
// unreachable, it returns a rejected promise, and a trap that behaves differently would send
// `httpSource` down an error path production never takes.
globalThis.fetch = (() => Promise.reject(new Error(REFUSAL))) as typeof globalThis.fetch;
