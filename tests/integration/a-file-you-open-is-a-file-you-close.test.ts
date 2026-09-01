/**
 * Every snippet that opens a file closes it.
 *
 * `api-sources.md` states the rule about `fileSource`: "After that, **closing is yours**. Call
 * `source.close()` when you're done." Seven snippets across five other pages opened one and never
 * did — and five of them used the shape that makes it impossible,
 * `await openEdf(await fileSource(path))`, where the source is never bound to anything the reader
 * could close.
 *
 * That stopped being a tidiness point. Node 26 turns a `FileHandle` collected while still open
 * into an uncaught `ERR_INVALID_STATE`; earlier versions printed a deprecation notice. edfcore
 * declares 22.12 as its floor and its CI matrix runs 22.12, 24 and 26, so the newest supported
 * runtime crashes on the code these pages tell people to copy — at whatever moment the collector
 * happens to run, which in a loop over a directory of recordings is somewhere in the middle.
 *
 * This is how it was found, and the finding is the argument for the check: the sweep added in
 * 0.6.16 opened one source per shape per spelling, passed locally and on Node 22.12 and 24, and
 * failed on 26 with twenty uncaught exceptions naming the temporary files by path.
 *
 * Same class as the snippet AGENTS.md carried until 0.4.259, which ended
 * `chunks[0].signals[0].digital` and did not compile: the file people are told to copy from taught
 * a line the toolchain rejects.
 *
 * `README.md` and `AGENTS.md` are swept alongside the site (0.6.18). Neither is a page the docs
 * collection loads, so the first pass over the site missed both — and the README is the one npm
 * renders, which makes it the snippet most people see before any other.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSource } from '../../src/node.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

interface Snippet {
  readonly page: string;
  readonly code: string;
}

/** Every fenced block on every documentation page that calls a source constructor holding a handle. */
const ROOT = new URL('../../', import.meta.url);

/**
 * Every page with snippets: the site's collection, plus the two markdown files that are not in it.
 * `README.md` is what npm renders and `AGENTS.md` is what an agent is pointed at, so between them
 * they are the likeliest source of a copied line.
 */
function pages(): ReadonlyArray<readonly [string, string]> {
  return [
    ...DOCS_PAGES,
    ...['README.md', 'AGENTS.md'].map(
      (name) => [name, readFileSync(new URL(name, ROOT), 'utf8')] as const,
    ),
  ];
}

function snippetsOpeningAFile(): readonly Snippet[] {
  const found: Snippet[] = [];
  for (const [page, text] of pages()) {
    for (const match of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
      const code = match[1] ?? '';
      // A declaration, a bare name list, or a mention inside a comment is not a call. AGENTS.md's
      // canonical snippet says `// or fileSource() from 'edfcore/node'` beside a `blobSource`,
      // which is prose about an alternative rather than a file being opened.
      const executable = code.replace(/\/\/.*$/gm, '');
      if (!/\b(fileSource|fileHandleSource)\(/.test(executable)) continue;
      if (/^\s*function (fileSource|fileHandleSource)\(/m.test(executable)) continue;
      if (!/\b(await|const|import)\b/.test(executable)) continue;
      found.push({ page, code });
    }
  }
  return found;
}

describe('the snippets this checks', () => {
  it('were found, so a passing run is not a vacuous one', () => {
    const snippets = snippetsOpeningAFile();
    expect(snippets.length).toBeGreaterThan(10);
    expect(new Set(snippets.map((one) => one.page)).size).toBeGreaterThan(4);
    // The two that are not in the docs collection, which is how they were missed the first time.
    expect(snippets.map((one) => one.page)).toContain('README.md');
  });

  it('can tell a snippet that closes from one that does not', () => {
    // The regex, on the two shapes, so a rule that matched everything would fail here.
    expect(/\bclose\s*(\?\.)?\(/.test('await source.close();')).toBe(true);
    expect(/\bclose\s*(\?\.)?\(/.test('await source.close?.();')).toBe(true);
    expect(/\bclose\s*(\?\.)?\(/.test('const recording = await openEdf(source);')).toBe(false);
  });
});

describe('every one of them', () => {
  it.each(snippetsOpeningAFile().map((one, index) => [`${one.page} #${index}`, one] as const))(
    '%s closes what it opened',
    (_where, snippet) => {
      expect(/\bclose\s*(\?\.)?\(/.test(snippet.code)).toBe(true);
    },
  );

  it('binds the source, rather than opening one nothing can reach', () => {
    // `await openEdf(await fileSource(path))` reads well and leaves the descriptor unreachable.
    // `recording.source` is a way back to it; naming the source is the clearer one, and it is what
    // `api-sources.md` tells the reader to do.
    for (const { page, code } of snippetsOpeningAFile()) {
      const inline = /openEdf\(\s*await (fileSource|fileHandleSource)\(/.test(code);
      expect({ page, inline }).toEqual({ page, inline: false });
    }
  });
});

describe('the pattern the pages now show', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edfcore-close-'));

  it('works, and closing twice is safe, which a finally block needs', async () => {
    const path = join(dir, 'a.edf');
    writeFileSync(path, minimalEdfPlus({ recordCount: 2, recordDurationSeconds: 1 }));
    const source = await fileSource(path);
    expect(typeof source.close).toBe('function');
    await source.close?.();
    await expect(source.close?.()).resolves.toBeUndefined();
  });
});
