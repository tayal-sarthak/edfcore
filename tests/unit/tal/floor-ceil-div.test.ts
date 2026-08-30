/**
 * `floorDiv` and `ceilDiv`, which nothing tested directly.
 *
 * `tal/ticks.ts` owns the tick conversions and, beside them, these two. Its docblock says why they
 * live there: "every caller is dividing a tick count by another tick count and three modules had
 * grown their own copies of the same four lines." Five modules import them now — `envelope.ts`,
 * `biosemi.ts`, `format-annotations.ts`, `sample-locate.ts` and `time/window.ts` — and
 * `ticks.test.ts`, the file named for this module, covers the parsers and the conversions and
 * neither of these. Every assertion they have is incidental, made through a caller that happens to
 * divide.
 *
 * The whole content of both functions is the negative side. Bigint `/` truncates toward zero, so
 * on a negative numerator it is neither floor nor ceiling, and it disagrees with both for exactly
 * the operands that are not exact multiples. That is not an edge case reached by a fuzzer: it is
 * reached by `trimToWindow` on the most ordinary input there is — see the last block below — and
 * by any window or onset before the start of record 0, which is how a pre-stimulus epoch is
 * spelled.
 *
 * So this checks the two functions against `Math.floor` and `Math.ceil` over a grid that crosses
 * zero, checks that bigint `/` really does disagree on part of it (or the grid would be proving
 * nothing), and enumerates the importers out of `src/` so that a sixth module cannot quietly grow
 * a sixth copy of the four lines.
 *
 * What this does NOT check: the callers' own arithmetic. `sampleAt`'s flooring is
 * `locate-edges.test.ts`, the clock's is `format-annotations.test.ts`, and the window bound's
 * derivation is `trim-window.test.ts`. This is only the primitive under all of them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ceilDiv, floorDiv } from '../../../src/tal/ticks.js';

/** Numerators either side of zero, including exact multiples and both neighbours of each. */
const NUMERATORS: readonly bigint[] = [
  -13n,
  -12n,
  -11n,
  -7n,
  -6n,
  -5n,
  -2n,
  -1n,
  0n,
  1n,
  2n,
  5n,
  6n,
  7n,
  11n,
  12n,
  13n,
];
/** `b` is positive by contract — every caller divides by a duration or a sample count. */
const DIVISORS: readonly bigint[] = [1n, 2n, 3n, 6n, 7n];

const CELLS = NUMERATORS.flatMap((a) => DIVISORS.map((b) => [a, b] as const));

describe('floorDiv rounds toward -Infinity', () => {
  it.each(CELLS)('at %s / %s', (a, b) => {
    // Small enough that float division is exact, so `Math.floor` is a real oracle here.
    expect(floorDiv(a, b)).toBe(BigInt(Math.floor(Number(a) / Number(b))));
  });

  it('is the bigint operator wherever the operator is already floored', () => {
    const same = CELLS.filter(([a, b]) => a >= 0n || a % b === 0n);
    expect(same.length).toBeGreaterThan(40);
    for (const [a, b] of same) expect(floorDiv(a, b)).toBe(a / b);
  });
});

describe('ceilDiv rounds toward +Infinity', () => {
  it.each(CELLS)('at %s / %s', (a, b) => {
    expect(ceilDiv(a, b)).toBe(BigInt(Math.ceil(Number(a) / Number(b))));
  });

  it('is the mirror of floorDiv, so the pair cannot drift apart', () => {
    for (const [a, b] of CELLS) expect(ceilDiv(a, b)).toBe(-floorDiv(-a, b));
  });
});

describe('the operator they exist to replace', () => {
  it('disagrees with floorDiv on every negative non-multiple, and only there', () => {
    const differ = CELLS.filter(([a, b]) => a / b !== floorDiv(a, b));
    expect(differ.length).toBeGreaterThan(20);
    for (const [a, b] of differ) {
      expect(a).toBeLessThan(0n);
      expect(a % b).not.toBe(0n);
      // Truncation lands one step LATER than the floor, which is the direction that matters:
      // for a pre-stimulus event it moves it toward the file start, by one sample.
      expect(a / b).toBe(floorDiv(a, b) + 1n);
    }
  });

  it('disagrees with ceilDiv on every positive non-multiple, and only there', () => {
    const differ = CELLS.filter(([a, b]) => a / b !== ceilDiv(a, b));
    expect(differ.length).toBeGreaterThan(20);
    for (const [a, b] of differ) {
      expect(a).toBeGreaterThan(0n);
      expect(a % b).not.toBe(0n);
      expect(a / b).toBe(ceilDiv(a, b) - 1n);
    }
  });
});

describe('the copies the docblock says it exists to prevent', () => {
  function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
        continue;
      }
      if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
    }
    return into;
  }

  const src = new URL('../../../src/', import.meta.url);
  const names = sourceFiles(src, '', []).sort();
  const text = new Map(names.map((name) => [name, readFileSync(new URL(name, src), 'utf8')]));

  it('found the tree, so a passing run is not a vacuous one', () => {
    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain('tal/ticks.ts');
  });

  it('are declared in exactly one module', () => {
    const declaring = names.filter((name) =>
      /(?:function|const) (?:floorDiv|ceilDiv)\b/.test(text.get(name) ?? ''),
    );
    expect(declaring).toEqual(['tal/ticks.ts']);
  });

  it('reach the five modules that divide, and every one of them imports them', () => {
    const users = names.filter(
      (name) => name !== 'tal/ticks.ts' && /\b(?:floorDiv|ceilDiv)\(/.test(text.get(name) ?? ''),
    );
    expect(users).toEqual([
      'biosemi.ts',
      'envelope.ts',
      'format-annotations.ts',
      'sample-locate.ts',
      'time/window.ts',
    ]);
    for (const name of users) {
      expect(text.get(name) ?? '').toMatch(
        /import \{[^}]*\b(?:ceilDiv|floorDiv)\b[^}]*\} from '\.{1,2}\/(?:\.\.\/)?tal\/ticks\.js'/s,
      );
    }
  });
});

describe('the negative side is reached by ordinary input', () => {
  /**
   * `trimToWindow` selects sample `j` when `ceil(j * D / S)` is in `[R, Rend)`, which it rewrites
   * as `floorDiv((R - 1) * S, D) + 1`. A window that begins at the chunk's OWN start makes `R`
   * zero, so the numerator is `-S` — negative for every file, with no unusual geometry and no
   * pre-stimulus anything. Truncation there returns `0` where the floor returns `-1`, and the
   * window loses its first sample.
   */
  const SAMPLES_PER_RECORD = 256n;
  const ONE_SECOND_IN_TICKS = 10_000_000n;

  it('at the first sample of a window aligned to its own chunk', () => {
    const numerator = (0n - 1n) * SAMPLES_PER_RECORD;
    expect(numerator).toBeLessThan(0n);
    expect(floorDiv(numerator, ONE_SECOND_IN_TICKS) + 1n).toBe(0n);
    // What the operator would have given: sample 0 excluded from a window that starts on it.
    expect(numerator / ONE_SECOND_IN_TICKS + 1n).toBe(1n);
  });

  it('and at the last, where the same rewrite is used without the +1', () => {
    // `Rend` is the window's end; one record of samples means the numerator is positive here, so
    // this edge is the one that would have looked fine while the other was dropping a sample.
    const numerator = (ONE_SECOND_IN_TICKS - 1n) * SAMPLES_PER_RECORD;
    expect(floorDiv(numerator, ONE_SECOND_IN_TICKS)).toBe(255n);
    expect(numerator / ONE_SECOND_IN_TICKS).toBe(255n);
  });
});
