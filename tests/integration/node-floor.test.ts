/**
 * One Node floor, written down in eleven places.
 *
 * `engines.node` is the only one a package manager reads. Everything else is prose that a human
 * has to keep in step: the README's compatibility line, four statements on `installation.md`, two
 * on `design-decisions.md`, the `llms.txt` summary handed to agents, and the docblocks in
 * `src/index.ts` and `src/cli.ts` — which `removeComments: false` copies verbatim into
 * `dist/*.d.ts`, so they are what an editor shows on hover.
 *
 * And one of them is not prose at all. The CI matrix's lowest entry is the version the suite is
 * actually PROVEN against; `engines.node` is the version consumers are told to have. A floor
 * raised in one and not the other is either a package that installs where it was never run, or a
 * matrix burning a job on a version nobody may use — and nothing here would have said which.
 *
 * So the floor is read from `package.json` and everything else is checked against it. The scan
 * recognises a REQUIREMENT — `Node 22.12`, `Node >= 22.12.0`, `Node ≥ 22.12`, `Node below 22.12`,
 * a `| Node | 22.12.0 |` table row — and deliberately not `Node v24.4.0`, the shape used for "the
 * runtime this was verified on". The `v` is what separates a version someone ran from a version
 * someone requires, and `src/bytes/latin1.ts` already writes it that way.
 *
 * A three-component mention must match all three; a two-component one must match major and minor,
 * because `22.12` and `22.12.0` both appear and both are right.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const ENGINES = (JSON.parse(read('../../package.json')) as { engines: { node: string } }).engines
  .node;

/** `>=22.12.0` — the one declaration a package manager enforces. */
const FLOOR = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(ENGINES);

/** Every file that could state the floor, including the site's generated endpoints. */
function sources(): ReadonlyArray<{ readonly name: string; readonly text: string }> {
  const found: Array<{ name: string; text: string }> = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      } else if (/\.(ts|md|astro)$/.test(entry.name)) {
        found.push({
          name: `${prefix}${entry.name}`,
          text: read(new URL(entry.name, dir).pathname),
        });
      }
    }
  };
  walk(new URL('../../src/', import.meta.url), 'src/');
  walk(new URL('../../website/src/', import.meta.url), 'website/src/');
  found.push({ name: 'README.md', text: read('../../README.md') });
  return found;
}

/**
 * `Node`, an optional comparison or table pipe, then a version. `**` is allowed on either side so
 * the README's `**Node** ≥ 22.12.0` is read the same as a plain sentence.
 */
const REQUIREMENT =
  /\bNode(?:\.js)?\*{0,2}[ \t]*(?:\||≥|>=|>|below|floor is)?[ \t]*\*{0,2}[ \t]*(\d+)\.(\d+)(?:\.(\d+))?\b/g;

const STATEMENTS = sources().flatMap(({ name, text }) =>
  [...text.matchAll(REQUIREMENT)].map((match) => ({
    where: `${name}: ${match[0]}`,
    major: match[1] as string,
    minor: match[2] as string,
    patch: match[3],
  })),
);

/** `node: ['22.12', '24', '26']` from the CI matrix, in the order written. */
const MATRIX = (() => {
  const workflow = read('../../.github/workflows/ci.yml');
  const list = /^\s*node:\s*\[([^\]]*)\]/m.exec(workflow);
  if (list === null) return undefined;
  return (list[1] as string).split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''));
})();

describe('the declared Node floor', () => {
  it('is a floor, and parses', () => {
    // Without this the comparisons below would run against `undefined` and pass on nothing.
    expect(FLOOR, `package.json engines.node is ${JSON.stringify(ENGINES)}`).not.toBeNull();
  });

  it('is the version CI actually runs', () => {
    expect(MATRIX, 'no `node: [...]` matrix in ci.yml').toBeDefined();
    // Lowest by version, not by position: reordering the matrix must not change what it proves.
    // Component by component, because `'9' < '10'` as strings is false and Node 10 is not lower.
    const compare = (a: string, b: string): number => {
      const left = a.split('.').map(Number);
      const right = b.split('.').map(Number);
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference !== 0) return difference;
      }
      return 0;
    };
    const lowest = [...(MATRIX ?? [])].sort(compare)[0];
    expect(lowest).toBe(`${FLOOR?.[1]}.${FLOOR?.[2]}`);
  });
});

describe('every statement of the floor names the same one', () => {
  it('found them, so a passing run is not a vacuous one', () => {
    expect(STATEMENTS.length).toBeGreaterThanOrEqual(8);
    const where = STATEMENTS.map((statement) => statement.where);
    expect(where.some((one) => one.startsWith('README.md:'))).toBe(true);
    expect(where.some((one) => one.startsWith('website/src/content/docs/installation.md:'))).toBe(
      true,
    );
    // The shipped docblocks: `removeComments: false` puts these in `dist/*.d.ts` verbatim.
    expect(where.some((one) => one.startsWith('src/index.ts:'))).toBe(true);
  });

  it('agrees with package.json', () => {
    const wrong = STATEMENTS.filter(
      (statement) =>
        statement.major !== FLOOR?.[1] ||
        statement.minor !== FLOOR?.[2] ||
        (statement.patch !== undefined && statement.patch !== FLOOR?.[3]),
    ).map((statement) => statement.where);
    expect(wrong, `the floor is ${ENGINES}`).toEqual([]);
  });

  it('reads a specific runtime as a specific runtime, not as a requirement', () => {
    // `Node v24.4.0` in `src/bytes/latin1.ts` records where a TextDecoder behaviour was verified.
    // Matching it would make this file demand that every version ever mentioned be the floor.
    expect(read('../../src/bytes/latin1.ts')).toContain('Node v24.4.0');
    expect(STATEMENTS.map((statement) => statement.where).join('\n')).not.toContain('24.4.0');
  });
});
