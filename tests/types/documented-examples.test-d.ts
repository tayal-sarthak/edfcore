/**
 * The documented examples that a reader copies whole, compiled.
 *
 * Five, not all of them. Those pages carry 55 `ts` fences between them and most are signatures and
 * one-liners; these are the ones a reader copies out and extends, and each needs a compiled twin
 * written by hand, so the set is deliberately small rather than derived.
 *
 * `api-sources.md`, `api-primitives.md` and `api-errors.md` are the pages that tell a reader to go
 * and write their own code: a custom `FetchLike` adapter, a handler for a duplicate channel label,
 * and an `edfErrorKind` switch. The first two
 * snippets were rejected by the compiler settings edfcore itself builds under —
 * `exactOptionalPropertyTypes` turned `{ ...init, signal }` into an error because `RequestInit`
 * declares `signal: AbortSignal | null`, and `noUncheckedIndexedAccess` turned
 * `error.matchingIndices[0]` into a `number | undefined`. Neither was wrong at runtime; they just
 * did not build, so the reader had to debug the documentation before they could use the extension
 * point it was teaching (fixed in 0.3.46).
 *
 * The guard runs in two directions. The copies below are REAL code, so `npm run typecheck`
 * compiles them under `tsconfig.json` — both strict flags on. The test then reads the fenced
 * blocks back out of the pages and asserts every line is present here, so editing a snippet in
 * the docs without editing the copy here fails.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type BlobLike,
  blobSource,
  EdfAmbiguousChannelError,
  type EdfHeader,
  type EdfRecording,
  type EdfSignal,
  type FetchLike,
  getSignal,
  isEdfError,
  openEdf,
  type RecordRange,
  readWindow,
  toPhysical,
  type WindowSelection,
} from '../../src/index.js';
import { fileSource } from '../../src/node.js';

// --- api-sources.md, "If you write your own FetchLike" ---------------------

export const instrumented: FetchLike = async (url, init) => {
  const signal = (init as { signal?: AbortSignal }).signal;
  console.log(url, init.headers.Range);
  // `?? null` rather than `signal`: `RequestInit.signal` is `AbortSignal | null`, and under
  // `exactOptionalPropertyTypes` an `undefined` is not assignable to it.
  return fetch(url, { ...init, signal: signal ?? null });
};

// --- api-primitives.md, the duplicate-label resolver -----------------------

export function resolve(header: EdfHeader, label: string): EdfSignal {
  try {
    return getSignal(header, label);
  } catch (error) {
    if (error instanceof EdfAmbiguousChannelError) {
      // Duplicates are real. Decide deliberately which one you meant.
      console.warn(`${label} matches indices ${error.matchingIndices.join(', ')}`);
      const [first] = error.matchingIndices;
      // An ambiguous match always holds at least two indices, but `noUncheckedIndexedAccess`
      // types the element as `number | undefined` and cannot know that.
      if (first === undefined) throw error;
      return getSignal(header, first);
    }
    throw error;
  }
}

// --- api-errors.md, the edfErrorKind switch --------------------------------
//
// Written WITHOUT the casts the page used to call load-bearing. `isEdfError` narrows to
// `AnyEdfError`, a discriminated union over the seven concrete classes, so the switch reaches each
// one's own fields directly. Compiling this IS the proof: if a cast were required, the page's claim
// that "reaching for error.budgetBytes without the cast is a compile error" would be true, and
// `npm run typecheck` would fail here instead (fixed in 0.3.65).

declare function askForLess(bytes: number): unknown;
// `EdfRangeError.available` is a `RecordRange`, not a count. Declaring it `number` here was a
// compile error, which is the guard doing its job on the guard.
declare function clampToFile(available: RecordRange): unknown;
declare function retry(): unknown;

export async function handleReadFailure(
  recording: EdfRecording,
  selection: WindowSelection,
): Promise<unknown> {
  try {
    return await readWindow(recording, selection);
  } catch (error) {
    if (!isEdfError(error)) throw error;

    switch (error.edfErrorKind) {
      case 'budget':
        return askForLess(error.budgetBytes);
      case 'range':
        return clampToFile(error.available);
      case 'source':
        return retry();
      default:
        throw error;
    }
  }
}

// `import.meta.glob` cannot read the importing file itself, and this test has to: the compiled
// copies above ARE the fixture it compares the pages against.
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const API_SOURCES = read('../../website/src/content/docs/api-sources.md');
const API_PRIMITIVES = read('../../website/src/content/docs/api-primitives.md');
const API_ERRORS = read('../../website/src/content/docs/api-errors.md');
const README = read('../../README.md');
const READING_SIGNALS = read('../../website/src/content/docs/reading-signals.md');
const SELF = read('./documented-examples.test-d.ts');

/** The fenced `ts` block containing `marker`, minus its import lines and blank lines. */
function snippet(page: string, marker: string): readonly string[] {
  for (const match of page.matchAll(/```ts\n([\s\S]*?)```/g)) {
    const body = match[1] as string;
    if (!body.includes(marker)) continue;
    return body.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('import '));
  }
  throw new Error(`no \`\`\`ts block containing ${JSON.stringify(marker)}`);
}

// --- README.md, the quick start under "How do I read an EDF file in JavaScript?" ---
//
// The first code most people run, on the npm front page, and it did not compile until 0.4.260.
// `chunk` is `EdfChunk | undefined` from the destructure and `chunk.signals[0]` is undefined-able
// under `noUncheckedIndexedAccess`, so the last line was `TS18048` and `TS2532`. One guard fixes
// both, and it is the guard the reader needs anyway: a window that selects nothing returns no
// chunks, which is an ordinary answer rather than an error.

declare const file: BlobLike;

export async function quickStart(): Promise<Float64Array> {
  const recording = await openEdf(blobSource(file));
  const fp1 = getSignal(recording.header, 'Fp1');

  const [chunk] = await readWindow(recording, {
    signalIndices: [fp1.index],
    startSeconds: 30,
    durationSeconds: 10,
  });
  // One chunk per contiguous run; a window that selects nothing returns none.
  if (chunk?.signals[0] === undefined) throw new Error('no data in that window');

  const microvolts = toPhysical(fp1, chunk.signals[0].digital); // Float64Array
  return microvolts;
}

// --- reading-signals.md, the guide's opening example -------------------------
//
// The same shape as the README quick start and broken the same way until 0.4.261. `fileSource`
// makes this one the Node twin: it is the first complete program on the page a reader lands on
// from "how do I read a signal".

export async function readingSignals(): Promise<Float64Array> {
  const recording = await openEdf(await fileSource('./overnight.edf'));
  const fp1 = getSignal(recording.header, 'Fp1');

  const [chunk] = await readWindow(recording, {
    startSeconds: 30,
    durationSeconds: 10,
    signalIndices: [fp1.index],
  });
  // One chunk per contiguous run; a window that selects nothing returns none.
  if (chunk?.signals[0] === undefined) throw new Error('no data in that window');

  const microvolts = toPhysical(fp1, chunk.signals[0].digital);
  return microvolts;
}

describe('the documented extension-point examples', () => {
  it('finds both snippets and this file', () => {
    // Without this, a marker that matched nothing would make every assertion below vacuous.
    expect(SELF).toContain('const instrumented: FetchLike');
    expect(snippet(API_SOURCES, 'const instrumented').length).toBeGreaterThan(3);
    expect(snippet(API_PRIMITIVES, 'function resolve(').length).toBeGreaterThan(3);
    expect(snippet(API_ERRORS, 'error.edfErrorKind').length).toBeGreaterThan(3);
    expect(snippet(README, 'const microvolts').length).toBeGreaterThan(3);
    expect(snippet(READING_SIGNALS, 'fileSource').length).toBeGreaterThan(3);
  });

  it.each([
    { page: 'api-sources.md', text: API_SOURCES, marker: 'const instrumented' },
    { page: 'api-primitives.md', text: API_PRIMITIVES, marker: 'function resolve(' },
    { page: 'api-errors.md', text: API_ERRORS, marker: 'error.edfErrorKind' },
    { page: 'README.md', text: README, marker: 'const microvolts' },
    { page: 'reading-signals.md', text: READING_SIGNALS, marker: 'fileSource' },
  ])('matches the compiled copy of the $page snippet line for line', ({ text, marker }) => {
    // The copies above are compiled by `npm run typecheck`. Anything the page says that they do
    // not say is a line nothing has checked.
    //
    // Compared trimmed: a page-level fragment sits at column 0, and the copy here has to live
    // inside a function to be compiled at all, so the indentation legitimately differs. The
    // CONTENT of every line must still be present.
    // Substring rather than exact-line, so a copy may carry an `export ` the page has no use for.
    // Runs of spaces are collapsed on both sides. A page aligns a trailing `// Float64Array`
    // comment by eye; Biome puts exactly one space before it here, and that difference is
    // formatting rather than a line the compiler has not seen.
    const flatten = (line: string) => line.trim().replace(/ {2,}/g, ' ');
    const mine = SELF.split('\n').map(flatten).join('\n');
    const unchecked = snippet(text, marker).filter((line) => !mine.includes(flatten(line)));
    expect(unchecked).toEqual([]);
  });

  it('keeps the narrowing the README quick start needs to compile', () => {
    /*
     * The comparison above runs one way: every line the page has must exist here. That catches a
     * page gaining a line nothing compiles, and not a page LOSING one — delete the guard from the
     * README and the remaining lines are all still present in the copy, so it passes.
     *
     * Which is the regression that matters here. Without `chunk?.signals[0] === undefined` the
     * snippet is `TS18048` and `TS2532` under `noUncheckedIndexedAccess`, exactly as it was until
     * 0.4.260, and the compiled copy cannot notice because it keeps its own guard.
     */
    for (const page of [
      snippet(README, 'const microvolts').join('\n'),
      snippet(READING_SIGNALS, 'fileSource').join('\n'),
    ]) {
      expect(page).toContain('=== undefined');
      expect(page).not.toMatch(/!\./);
    }
  });
});
