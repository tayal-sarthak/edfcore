/**
 * The two extension-point examples in the docs compile.
 *
 * `api-sources.md` and `api-primitives.md` are the pages that tell a reader to go and write their
 * own code: a custom `FetchLike` adapter, and a handler for a duplicate channel label. Both
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
  EdfAmbiguousChannelError,
  type EdfHeader,
  type EdfSignal,
  type FetchLike,
  getSignal,
} from '../../src/index.js';

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

// `import.meta.glob` cannot read the importing file itself, and this test has to: the compiled
// copies above ARE the fixture it compares the pages against.
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const API_SOURCES = read('../../website/src/content/docs/api-sources.md');
const API_PRIMITIVES = read('../../website/src/content/docs/api-primitives.md');
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

describe('the documented extension-point examples', () => {
  it('finds both snippets and this file', () => {
    // Without this, a marker that matched nothing would make every assertion below vacuous.
    expect(SELF).toContain('const instrumented: FetchLike');
    expect(snippet(API_SOURCES, 'const instrumented').length).toBeGreaterThan(3);
    expect(snippet(API_PRIMITIVES, 'function resolve(').length).toBeGreaterThan(3);
  });

  it.each([
    { page: 'api-sources.md', text: API_SOURCES, marker: 'const instrumented' },
    { page: 'api-primitives.md', text: API_PRIMITIVES, marker: 'function resolve(' },
  ])('matches the compiled copy of the $page snippet line for line', ({ text, marker }) => {
    // The copies above are compiled by `npm run typecheck`. Anything the page says that they do
    // not say is a line nothing has checked.
    const unchecked = snippet(text, marker).filter((line) => !SELF.includes(line));
    expect(unchecked).toEqual([]);
  });
});
