/**
 * The first code sample on the landing page compiles.
 *
 * `doc-snippets-compile.test.ts` sweeps every fenced block on the site that imports from
 * `edfcore` and compiles all of them. The landing page's samples are template literals inside
 * `index.astro`, not fenced markdown, so the sweep cannot see them — and that page's own docblock
 * said so: "nothing checks that they still compile."
 *
 * One of them is the code most people who ever see edfcore will read. It ended
 * `chunk.signals[0].digital`, which is two `TS2532`s under `noUncheckedIndexedAccess` — the same
 * line, broken the same way, that 0.4.259 fixed in `AGENTS.md` after that file "taught a line the
 * compiler rejects" (fixed in 0.6.78).
 *
 * The guard runs both ways, like `agents-snippet.test-d.ts`: the copy below is real code compiled
 * by `npm run typecheck`, and the assertions below read the sample back out of `index.astro`
 * and check every line of it is present here. Editing one without the other fails.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blobSource, getSignal, openEdf, readWindow, toPhysical } from '../../src/index.js';

declare const file: Blob;

export async function readTenSeconds(): Promise<Float64Array> {
  const recording = await openEdf(blobSource(file));
  const fp1 = getSignal(recording.header, 'Fp1');

  const [chunk] = await readWindow(recording, {
    signalIndices: [fp1.index],
    startSeconds: 30,
    durationSeconds: 10,
  });
  if (chunk === undefined) throw new Error('no records cover that window');
  const [series] = chunk.signals;
  if (series === undefined) throw new Error('no signal in that chunk');

  const microvolts = toPhysical(fp1, series.digital);
  return microvolts;
}

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const PAGE = read('website/src/pages/index.astro');
const TWIN = read('tests/types/landing-snippet.test-d.ts');

/** The body of ``const readExample = `…`;`` */
const SAMPLE: readonly string[] = (() => {
  const match = /const readExample = `([\s\S]*?)`;/.exec(PAGE);
  if (match?.[1] === undefined) throw new Error('index.astro no longer defines readExample');
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
})();

describe('the sample on the landing page', () => {
  it('is found, and is a whole program rather than a fragment', () => {
    expect(SAMPLE.length).toBeGreaterThan(8);
    expect(SAMPLE[0]).toContain("from 'edfcore'");
  });

  it('guards both index reads, which is what the compiler requires', () => {
    expect(SAMPLE).toContain(
      "if (chunk === undefined) throw new Error('no records cover that window');",
    );
    expect(SAMPLE).toContain(
      "if (series === undefined) throw new Error('no signal in that chunk');",
    );
  });

  it('no longer ends on an unguarded index read', () => {
    expect(SAMPLE.join('\n')).not.toContain('chunk.signals[0].digital');
  });
});

/** The names in an `import { … }` line, sorted — biome orders the twin's and the page's differs. */
const importedNames = (line: string): readonly string[] =>
  [...(/import \{([^}]*)\}/.exec(line)?.[1] ?? '').matchAll(/\w+/g)].map((m) => m[0]).sort();

describe('the twin that npm run typecheck compiles', () => {
  it('imports the same names, however they are ordered', () => {
    const fromPage = SAMPLE.find((line) => line.startsWith('import ')) ?? '';
    const fromTwin =
      TWIN.split('\n').find((line) => line.includes("from '../../src/index.js'")) ?? '';
    expect(importedNames(fromPage)).toEqual(importedNames(fromTwin));
    // And the twin points at the source tree, which is what makes it compile here.
    expect(fromTwin).toContain("from '../../src/index.js'");
  });

  it('contains every other line of it', () => {
    const twinLines = new Set(TWIN.split('\n').map((line) => line.trim()));
    const missing = SAMPLE.filter((line) => !line.startsWith('import ') && !twinLines.has(line));
    expect(missing, 'the page and its compiled twin have drifted apart').toEqual([]);
  });
});
