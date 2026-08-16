/**
 * `require()` of this package works from CommonJS, executed rather than asserted.
 *
 * This is the claim the Node floor rests on. The README's compatibility list says "ESM only.
 * `require()` works on Node ≥ 22.12 (there is no top-level `await` anywhere in the module
 * graph, which is what makes that safe)"; `installation.md` repeats it and explains that 22.12
 * is exactly where `require(esm)` became unflagged; `design-decisions.md` weighs shipping
 * ESM-only against it; `src/index.ts` states it as a rule the barrel keeps; and the CI matrix
 * pins 22.12 as the floor for the same reason. Five statements, and until now nothing ran them.
 *
 * Nothing else in the suite could. The whole repository is ESM under vitest, where every import
 * is asynchronous and a top-level `await` is ordinary — the exact condition that breaks
 * `require()` is invisible from inside. A grep for `await` at column zero would be a different
 * check anyway: what matters is the graph Node walks, transitively, in the artifact that ships.
 *
 * So Node is the oracle. A child process requires `dist/` from CommonJS, and a module graph with
 * a top-level `await` anywhere in it makes that call throw `ERR_REQUIRE_ASYNC_MODULE` — no
 * heuristic, no parsing, and no way for the check to agree with a mistake the way a reader of
 * the same source would.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = new URL('../../dist/', import.meta.url);
const TOP_LEVEL_AWAIT = fileURLToPath(new URL('../support/top-level-await.mjs', import.meta.url));

/** What the child prints: what it required, and what happened. */
interface Attempt {
  readonly ok: boolean;
  readonly exports?: readonly string[];
  readonly code?: string;
}

/**
 * Requires each path from a CommonJS realm in a child process, and reports the outcome.
 *
 * A child rather than `createRequire` here, because the modules are already in this process's ESM
 * loader: requiring them from inside vitest would hit a graph Node has finished instantiating,
 * which is not the state a consumer's `require()` meets.
 */
function requireFromCommonJs(paths: readonly string[]): readonly Attempt[] {
  if (!existsSync(fileURLToPath(new URL('index.js', DIST)))) {
    // A failure, not a skip — a skipped test here would restore the silence this file ends.
    throw new Error(
      'dist/index.js is missing, so there is nothing to require. Next: run `npm run build` ' +
        '(`npm run check` builds before it tests for this reason).',
    );
  }

  const script = `
    const { createRequire } = require('node:module');
    const require_ = createRequire(${JSON.stringify(fileURLToPath(DIST))});
    const out = [];
    for (const path of ${JSON.stringify(paths)}) {
      try {
        out.push({ ok: true, exports: Object.keys(require_(path)) });
      } catch (error) {
        out.push({ ok: false, code: error.code });
      }
    }
    process.stdout.write(JSON.stringify(out));
  `;

  // No cwd of ours and no vitest in scope: a plain `node -e`, the way a consumer's build runs.
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
}

const ENTRY_POINTS = ['./index.js', './node.js', './validate.js'] as const;

const [universal, nodeEntry, validateEntry, asyncModule] = requireFromCommonJs([
  ...ENTRY_POINTS,
  TOP_LEVEL_AWAIT,
]);

describe('the harness can tell a requirable graph from one it cannot require', () => {
  it('refuses a module with a top-level await, with the error that names why', () => {
    // Without this the three assertions below would pass on a child that required nothing at all.
    expect(asyncModule?.ok).toBe(false);
    expect(asyncModule?.code).toBe('ERR_REQUIRE_ASYNC_MODULE');
  });
});

describe('every entry point loads from CommonJS', () => {
  it.each([
    ['edfcore', universal, 'openEdf'],
    ['edfcore/node', nodeEntry, 'fileSource'],
    ['edfcore/validate', validateEntry, 'validateRecording'],
  ] as const)('%s', (_name, attempt, symbol) => {
    expect(attempt?.code, 'require() failed').toBeUndefined();
    expect(attempt?.ok).toBe(true);
    // The namespace, not just the absence of a throw: a require that resolved to `{}` is not a
    // working entry point, and every one of these is documented as importable by name.
    expect(attempt?.exports).toContain(symbol);
  });
});
