/**
 * `biome check` reports nothing, so a new finding is visible.
 *
 * `npm run lint` is `biome check --error-on-warnings .`, which escalates warnings and leaves
 * `info`-level findings alone — so two of them sat in the tree indefinitely, named in the handoff
 * notes as "two pre-existing infos ... do not fail it". Both were one-line, behaviour-identical
 * rewrites: a string concatenation where a template literal reads the same, and a `findIndex`
 * comparing against a single value where `indexOf` says it.
 *
 * Neither was worth a release on its own. Clearing them to ZERO is, for the reason 0.6.303 gives
 * about the Corpus job's red cross: a permanent signal carries nothing. With two tolerated infos the
 * only way to notice a third is to remember the number; from zero, any output at all is new.
 *
 * The count is asserted rather than the two rules by name, because naming them would make this file
 * a list to update instead of a baseline to hold.
 *
 * What this does NOT do is change the gate. `npm run lint` still passes on an info, deliberately —
 * an info is a suggestion and a failing build is not the right answer to one. This file is the thing
 * that notices (0.6.309).
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);

/** `biome check` over the repository, as `npm run lint` invokes it, minus the escalation. */
function check(): string {
  try {
    return execFileSync('npx', ['biome', 'check', '--reporter=summary', '.'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // A non-zero exit still carries the report, and a real finding is what this test is for.
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

describe('a lint baseline of zero', () => {
  it('reports no diagnostics of any severity', () => {
    const report = check();
    // Biome prints "Found N errors/warnings/infos" only when there is something to report.
    expect(report, report).not.toMatch(/Found \d+ (error|warning|info)/);
  });

  it('still ran, so a passing run is not a vacuous one', () => {
    expect(check()).toMatch(/Checked \d+ files/);
  });

  it('leaves the gate alone: lint escalates warnings, not infos', () => {
    const manifest = JSON.parse(
      execFileSync('cat', ['package.json'], { cwd: ROOT, encoding: 'utf8' }),
    ) as { scripts: Record<string, string> };
    // An info is a suggestion, and a failing build is not the right answer to one. This file is
    // what notices instead.
    expect(manifest.scripts.lint).toBe('biome check --error-on-warnings .');
  });
});
