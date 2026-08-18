/**
 * The snippet in `AGENTS.md` compiles.
 *
 * That file's "Using edfcore in generated code" section exists to be copied verbatim into
 * somebody's project, which makes it the highest-leverage code in the repository and the piece
 * nothing compiled. `documented-examples.test-d.ts` does this for three website snippets after
 * 0.3.46 found two of them rejected by edfcore's own compiler settings; this is the same guard on
 * the one an agent is most likely to paste.
 *
 * It was broken in exactly that way. The snippet ended `chunks[0].signals[0].digital`, and under
 * `noUncheckedIndexedAccess` — on in this repo and in every strict project — both index reads are
 * `T | undefined`, so the last line was two `error TS2532`s. The fix is narrowing rather than a
 * `!`, which is what 0.4.208 settled for this codebase (fixed in 0.4.259).
 *
 * The guard runs both ways, like the website one: the copy below is real code compiled by
 * `npm run typecheck`, and the test reads the fenced block back out of `AGENTS.md` and asserts
 * every line of it is present here. Editing one without the other fails.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blobSource, getSignal, openEdf, readWindow, toPhysical } from '../../src/index.js';

declare const file: Blob;

export async function fiveCalls(): Promise<Float64Array> {
  const recording = await openEdf(blobSource(file));
  const signal = getSignal(recording.header, 'Fp1');
  const [chunk] = await readWindow(recording, {
    signalIndices: [signal.index],
    startSeconds: 30,
    durationSeconds: 10,
  });
  // One chunk per contiguous run, and none at all for a window that selects nothing.
  if (chunk === undefined) throw new Error('no records cover that window');
  const [series] = chunk.signals;
  if (series === undefined) throw new Error('no signal in that chunk');
  const microvolts = toPhysical(signal, series.digital);
  return microvolts;
}

const AGENTS = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const SELF = readFileSync(new URL('./agents-snippet.test-d.ts', import.meta.url), 'utf8');

/** The fenced `ts` block of the generated-code section, minus imports and blank lines. */
const SNIPPET: readonly string[] = (() => {
  const section = AGENTS.slice(AGENTS.indexOf('## Using edfcore in generated code'));
  const fence = /```ts\n([\s\S]*?)```/.exec(section);
  if (fence === null) throw new Error('no ```ts block under "Using edfcore in generated code"');
  return (fence[1] as string)
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('import '));
})();

describe('the AGENTS.md snippet', () => {
  it('was found, so a passing run is not a vacuous one', () => {
    expect(SNIPPET.length).toBeGreaterThan(8);
    expect(SNIPPET.some((line) => line.includes('toPhysical('))).toBe(true);
  });

  it('is line for line what is compiled above', () => {
    // `// or fileSource() from 'edfcore/node'` is a trailing comment on the openEdf line, and the
    // copy above drops it — compare on the code, not on the aside.
    const missing = SNIPPET.map((line) => line.replace(/\s+\/\/ or fileSource.*$/, '')).filter(
      (line) => !SELF.includes(line),
    );
    expect(missing, 'lines in AGENTS.md that no compiled copy here contains').toEqual([]);
  });

  it('narrows rather than asserting, which is what makes it compile', () => {
    // The shape 0.4.259 replaced, and the shape 0.4.208 settled on instead. Asserted against the
    // SNIPPET, not this file: the docblock above quotes `chunks[0]` to explain what was wrong, and
    // a whole-file match would find the quotation rather than the claim.
    const code = SNIPPET.join('\n');
    expect(code).not.toContain('chunks[0]');
    expect(code).not.toMatch(/!\./);
    expect(code).toContain('=== undefined');
  });
});
