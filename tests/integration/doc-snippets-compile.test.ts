/**
 * Every self-contained example in the documentation compiles.
 *
 * `documented-examples.test-d.ts` compiles five snippets by keeping a hand-written twin of each,
 * which is thorough and does not scale: it covers the five somebody remembered. The site has 102
 * fenced blocks that import from `edfcore`, and sweeping all of them found two complete programs
 * that a reader could paste and watch fail — the opening example of `reading-signals.md` and the
 * worked example on `annotations.md`, both fixed in 0.4.261 and 0.4.262, and both broken the same
 * way the README quick start was in 0.4.260.
 *
 * So the sweep runs here instead of by hand. Every fence is extracted, its `edfcore` imports are
 * pointed at `src/`, and one `tsc` compiles the lot under the flags this repository builds with —
 * `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
 *
 * A page is a reference, not a program, so most fences legitimately do not stand alone: they use
 * a `recording` or a `header` declared in an earlier block. Those report `TS2304 Cannot find
 * name`, and a fence with any of those is a fragment this check cannot judge — it is skipped, and
 * the count of skipped ones is asserted to stay sane so the exemption cannot quietly swallow
 * everything. A fence with NO missing names is a complete program, and a complete program that
 * does not compile is a defect on a page.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Pages plus the two markdown files at the repo root that also carry runnable examples. */
const TEXTS: ReadonlyArray<{ readonly name: string; readonly text: string }> = [
  ...[...DOCS_PAGES].map(([name, text]) => ({ name, text })),
  { name: 'README.md', text: readFileSync(join(ROOT, 'README.md'), 'utf8') },
  { name: 'AGENTS.md', text: readFileSync(join(ROOT, 'AGENTS.md'), 'utf8') },
];

interface Fence {
  readonly id: string;
  readonly page: string;
  readonly body: string;
}

/** Fenced `ts` blocks that import from the package — the ones meant to be run rather than read. */
const FENCES: readonly Fence[] = TEXTS.flatMap(({ name, text }) => {
  const found: Fence[] = [];
  let index = 0;
  for (const match of text.matchAll(/```ts\n([\s\S]*?)```/g)) {
    const body = match[1] as string;
    if (!/^import .*from 'edfcore/m.test(body)) continue;
    index += 1;
    found.push({ id: `${name.replace(/\.mdx?$/, '')}-${index}`, page: name, body });
  }
  return found;
});

/** Compiles every fence in one pass and returns the diagnostics, keyed by fence id. */
function compileAll(): ReadonlyMap<string, readonly string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'edfcore-fences-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  // The fences are ESM and `verbatimModuleSyntax` refuses ESM syntax in a CommonJS file.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');

  for (const fence of FENCES) {
    const source = fence.body
      .replace(/from 'edfcore\/node'/g, `from '${join(ROOT, 'src/node.js')}'`)
      .replace(/from 'edfcore\/validate'/g, `from '${join(ROOT, 'src/validate.js')}'`)
      .replace(/from 'edfcore'/g, `from '${join(ROOT, 'src/index.js')}'`);
    writeFileSync(join(dir, `${fence.id}.ts`), source);
  }

  let output = '';
  try {
    execFileSync(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--strict',
        '--noUncheckedIndexedAccess',
        '--exactOptionalPropertyTypes',
        '--target',
        'es2022',
        '--module',
        'node18',
        '--moduleResolution',
        'node16',
        '--lib',
        'ES2022,DOM,DOM.Iterable',
        '--types',
        'node',
        '--verbatimModuleSyntax',
        '--skipLibCheck',
        ...FENCES.map((fence) => join(dir, `${fence.id}.ts`)),
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (error) {
    // tsc exits non-zero when it reports anything; the diagnostics are on stdout either way.
    output = (error as { stdout?: string }).stdout ?? '';
  }

  // tsc prints paths relative to its cwd, so the temp directory's own prefix is not what comes
  // back — take the basename. Slicing by `dir.length` looked right and matched nothing, which
  // made every fence appear to compile.
  const byFence = new Map<string, string[]>();
  for (const line of output.split('\n')) {
    const at = /([A-Za-z0-9._-]+)\.ts\(\d+,\d+\): (error TS\d+: .*)$/.exec(line.trim());
    if (at === null) continue;
    const id = at[1] as string;
    const list = byFence.get(id) ?? [];
    list.push(at[2] as string);
    byFence.set(id, list);
  }
  return byFence;
}

const DIAGNOSTICS = compileAll();

/**
 * Two markers, both of which say "this block is part of something larger" rather than "this block
 * is wrong".
 *
 * `TS2304 Cannot find name` is a fence using a `recording` or a `header` an earlier block on the
 * page declared. `TS1108` is a bare `return`, which means the fence is a function BODY shown
 * without its signature — `api-errors.md` and `diagnostics.md` both teach a handler that way, and
 * a body is a perfectly good thing to show.
 *
 * Neither marker is a judgement about the code, which is the point: a fence carrying one cannot be
 * compiled in isolation, so this check says nothing about it rather than guessing.
 */
const isFragment = (id: string): boolean =>
  (DIAGNOSTICS.get(id) ?? []).some(
    (message) =>
      message.includes('TS2304: Cannot find name') ||
      message.includes("TS1108: A 'return' statement"),
  );

describe('the documentation examples were compiled', () => {
  it('extracted enough of them that a passing run is not a vacuous one', () => {
    expect(FENCES.length).toBeGreaterThan(90);
    expect(FENCES.some((fence) => fence.page === 'README.md')).toBe(true);
    expect(FENCES.some((fence) => fence.page === 'reading-signals.md')).toBe(true);
  });

  it('ran the compiler, rather than silently reporting nothing', () => {
    // Fragments MUST produce diagnostics. Zero of them would mean tsc never ran, or ran on an
    // empty file list, and every assertion below would pass on nothing.
    expect(DIAGNOSTICS.size).toBeGreaterThan(10);
  });

  it('leaves a workable number standing alone', () => {
    // The exemption is for fences that reference a page-level `recording`; if it ever covered
    // almost everything, this check would be exempting itself out of existence.
    const complete = FENCES.filter((fence) => !isFragment(fence.id));
    expect(complete.length).toBeGreaterThan(20);
  });
});

describe('every self-contained example compiles', () => {
  it('reports no error in a fence that declares everything it uses', () => {
    const broken = FENCES.filter((fence) => !isFragment(fence.id))
      .map((fence) => ({ fence, errors: DIAGNOSTICS.get(fence.id) ?? [] }))
      .filter(({ errors }) => errors.length > 0)
      .map(({ fence, errors }) => `${fence.page} block ${fence.id}: ${errors[0]}`);
    expect(broken, 'complete examples that do not compile').toEqual([]);
  });
});
