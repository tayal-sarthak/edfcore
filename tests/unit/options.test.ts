/**
 * `options.ts`, tested directly for the first time.
 *
 * It is 66 lines, it is Layer 1, and no test imported it: every path through it ran only as a side
 * effect of some larger read. That is thin cover for the module whose whole job is refusing bad
 * input, and whose docblock records two separate misdiagnoses that reached users — a `NaN` budget
 * surfacing as an `EdfBudgetError` advising "read fewer records per call", which no record count
 * satisfies, and as an `EdfRangeError` about `count: NaN` telling the caller to clamp a range the
 * function does not take.
 *
 * The distinction the module is built on is `undefined` versus `NaN`. An omitted option means "use
 * the default"; a `NaN` means a caller computed something and got nothing. Treating them alike
 * applies the default to a real mistake, and `Number()` on an absent environment variable, query
 * parameter or JSON key produces `NaN` without anyone writing it.
 *
 * The second half checks the inventory the docblock states — six modules resolve the budget and
 * two hand it on. That sentence is the argument that the guard is worth anything: "a guard that
 * only one of the eight applies is not a guard", and a seventh consumer resolving it by hand is
 * how that stops being true.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_MATERIALIZE_BYTES } from '../../src/constants.js';
import { requireFiniteOption, resolveMaterializeBudget } from '../../src/options.js';

describe('requireFiniteOption', () => {
  it('takes the default only for undefined', () => {
    expect(requireFiniteOption(undefined, 'blockBytes', 4096)).toBe(4096);
    expect(requireFiniteOption(0, 'blockBytes', 4096)).toBe(0);
    expect(requireFiniteOption(-1, 'blockBytes', 4096)).toBe(-1);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses %p rather than falling back',
    (value) => {
      expect(() => requireFiniteOption(value, 'blockBytes', 4096)).toThrow(RangeError);
    },
  );

  it('names the option and says where a NaN comes from', () => {
    // The message contract: the argument that is wrong, and the next step.
    expect(() => requireFiniteOption(Number.NaN, 'maxConcurrency', 4)).toThrow(
      /options\.maxConcurrency must be a finite number/,
    );
    expect(() => requireFiniteOption(Number.NaN, 'maxConcurrency', 4)).toThrow(/Next:/);
  });

  it('is a plain RangeError, because this is the caller and not the file', () => {
    // The split `isEdfError` documents: an EdfError is about a recording, this is about code.
    try {
      requireFiniteOption(Number.NaN, 'blockBytes', 1);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect((error as { edfErrorKind?: string }).edfErrorKind).toBeUndefined();
    }
  });
});

describe('resolveMaterializeBudget', () => {
  it('defaults when omitted', () => {
    expect(resolveMaterializeBudget(undefined)).toBe(DEFAULT_MAX_MATERIALIZE_BYTES);
  });

  it('allows zero, which refuses every allocation rather than meaning "unset"', () => {
    expect(resolveMaterializeBudget(0)).toBe(0);
  });

  it('refuses a negative budget, and says what the number means', () => {
    expect(() => resolveMaterializeBudget(-1)).toThrow(/must not be negative/);
    expect(() => resolveMaterializeBudget(-1)).toThrow(/bytes a single call may allocate/);
  });

  it('refuses NaN before the sign check, so the message names the right problem', () => {
    // `NaN >= 0` is false, so a negative-check written first would call NaN negative.
    expect(() => resolveMaterializeBudget(Number.NaN)).toThrow(/must be a finite number/);
  });
});

describe('the inventory the module claims', () => {
  const SRC = new URL('../../src/', import.meta.url);
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const MODULES: ReadonlyArray<{ readonly name: string; readonly code: string }> = (function walk(
    dir: URL,
    prefix: string,
    into: Array<{ name: string; code: string }>,
  ) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(child, `${prefix}${entry.name}/`, into);
      else if (entry.name.endsWith('.ts')) {
        into.push({ name: `${prefix}${entry.name}`, code: strip(readFileSync(child, 'utf8')) });
      }
    }
    return into;
  })(SRC, '', []);

  /** Named in the docblock as handing the option on without resolving it. */
  const PASS_THROUGH = ['biosemi.ts', 'io/cached.ts'];

  it('read the tree, so a passing run is not a vacuous one', () => {
    expect(MODULES.length).toBeGreaterThan(40);
    expect(MODULES.some(({ name }) => name === 'options.ts')).toBe(true);
  });

  it('has six resolvers, the six it names', () => {
    const resolvers = MODULES.filter(
      ({ name, code }) => name !== 'options.ts' && code.includes('resolveMaterializeBudget'),
    ).map(({ name }) => name);
    expect(resolvers.sort()).toEqual([
      'decode/digital.ts',
      'decode/physical.ts',
      'envelope.ts',
      'io/read.ts',
      'record-index.ts',
      'validate.ts',
    ]);
  });

  it('leaves no module using the option without going through it', () => {
    const rogue = MODULES.filter(
      ({ name, code }) =>
        name !== 'options.ts' &&
        name !== 'types.ts' &&
        name !== 'errors.ts' && // names it in a message, does not read one
        !PASS_THROUGH.includes(name) &&
        code.includes('maxMaterializeBytes') &&
        !code.includes('resolveMaterializeBudget'),
    ).map(({ name }) => name);
    expect(
      rogue,
      'modules reading maxMaterializeBytes raw — the guard does not apply there',
    ).toEqual([]);
  });
});
