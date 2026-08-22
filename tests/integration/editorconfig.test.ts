/**
 * `.editorconfig` is enforced on the files no formatter reaches.
 *
 * Biome formats the `.ts`, `.mjs`, `.json` and `.jsonc` files — that is its whole
 * `files.includes` — and `npm run lint` reports a deviation as an error. Everything else here is
 * governed by `.editorconfig` and by nothing at all: the markdown, the two workflows, the
 * `.astro` components, the stylesheet, the Python under `scripts/golden/`, `og.svg` and
 * `LICENSE`. Between them they are most of what a reader ever opens.
 *
 * `.editorconfig` is a request to an editor, not a check. An editor that does not read it, a file
 * written by a tool, a paste out of a terminal, a heredoc in a shell — each produces a file the
 * declaration says should not exist, and every one of them is invisible in review: a missing final
 * newline shows as `\ No newline at end of file` in one diff and then never again, and a CRLF line
 * ending shows as nothing until the day a whole file appears rewritten.
 *
 * `og.svg` had been missing its final newline since it was drawn (fixed in 0.4.397).
 *
 * The rules are read out of `.editorconfig` rather than restated here, so deleting a line from it
 * turns the corresponding check off — and the check that it still declares all five is what makes
 * that a visible decision rather than a silent one.
 *
 * What this does NOT check: the `[*.md]` exemption in the other direction. Markdown MAY carry
 * trailing whitespace, because two spaces is a hard line break, and no file here uses one today —
 * so the override is honoured rather than exercised.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);

/** `[section] key = value`, flattened to `section` → `key` → `value`. */
const DECLARED: ReadonlyMap<string, ReadonlyMap<string, string>> = (() => {
  const sections = new Map<string, Map<string, string>>();
  let current = '';
  for (const line of readFileSync(new URL('.editorconfig', ROOT), 'utf8').split('\n')) {
    const section = /^\[(.+)\]$/.exec(line.trim());
    if (section !== null) {
      current = section[1] as string;
      sections.set(current, new Map());
      continue;
    }
    const pair = /^([a-z_]+)\s*=\s*(\S+)$/.exec(line.trim());
    if (pair !== null) sections.get(current)?.set(pair[1] as string, pair[2] as string);
  }
  return sections;
})();

const rule = (key: string): string | undefined => DECLARED.get('*')?.get(key);

/** What Biome already formats, and therefore what this file leaves alone. */
const FORMATTED = /\.(ts|mjs|json|jsonc)$/;

/** Bytes rather than text: nothing about a line ending applies to them. */
const BINARY = /\.(edf|bdf|png)$/;

/** Every tracked file `.editorconfig` governs and no formatter does. */
const GOVERNED: readonly string[] = execFileSync('git', ['ls-files'], {
  cwd: fileURLToPath(ROOT),
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => path !== '' && !FORMATTED.test(path) && !BINARY.test(path));

const bytes = (path: string): Buffer => readFileSync(new URL(path, ROOT));

/** Lines that end in a space or a tab, by 1-based number. */
const trailing = (text: string): readonly number[] =>
  text
    .split('\n')
    .map((line, at) => (/[ \t]$/.test(line) ? at + 1 : 0))
    .filter((at) => at !== 0);

describe('the declaration', () => {
  it('states every rule this checks, so removing one is a visible decision', () => {
    expect(rule('end_of_line')).toBe('lf');
    expect(rule('insert_final_newline')).toBe('true');
    expect(rule('trim_trailing_whitespace')).toBe('true');
    expect(rule('indent_style')).toBe('space');
    expect(rule('charset')).toBe('utf-8');
    // And the one exemption, which is why the trailing-whitespace check is not repo-wide.
    expect(DECLARED.get('*.md')?.get('trim_trailing_whitespace')).toBe('false');
  });

  it('governs a set worth checking, so a passing run is not a vacuous one', () => {
    expect(GOVERNED.length).toBeGreaterThan(40);
    // One of each kind no formatter covers, named so a glob that stopped matching is a failure.
    for (const path of [
      'README.md',
      '.github/workflows/ci.yml',
      'website/src/layouts/Base.astro',
      'website/src/styles/tokens.css',
      'website/design/og.svg',
      'LICENSE',
    ]) {
      expect(GOVERNED, `${path} is no longer governed`).toContain(path);
    }
    expect(GOVERNED.some((path) => path.endsWith('.py'))).toBe(true);
    // And the formatted files really are out, rather than the filter matching nothing.
    expect(GOVERNED).not.toContain('package.json');
    expect(GOVERNED).not.toContain('src/index.ts');
  });

  it('can tell a violating line from a clean one', () => {
    expect(trailing('one\ntwo \nthree\t\nfour')).toEqual([2, 3]);
    expect(trailing('one\ntwo\n')).toEqual([]);
  });
});

describe('every file it governs keeps it', () => {
  it('ends every one with a newline', () => {
    const unterminated = GOVERNED.filter((path) => {
      const buffer = bytes(path);
      return buffer.length > 0 && buffer[buffer.length - 1] !== 0x0a;
    });
    expect(unterminated, 'insert_final_newline = true').toEqual([]);
  });

  it('ends every line with lf alone', () => {
    const carriage = GOVERNED.filter((path) => bytes(path).includes(0x0d));
    expect(carriage, 'end_of_line = lf').toEqual([]);
  });

  it('leaves no trailing whitespace, except where markdown is allowed it', () => {
    const dirty = GOVERNED.filter((path) => !path.endsWith('.md')).flatMap((path) => {
      const lines = trailing(bytes(path).toString('utf8'));
      return lines.length === 0 ? [] : [`${path}:${lines.join(',')}`];
    });
    expect(dirty, 'trim_trailing_whitespace = true').toEqual([]);
  });

  it('indents with spaces', () => {
    const tabbed = GOVERNED.filter((path) =>
      bytes(path)
        .toString('utf8')
        .split('\n')
        .some((line) => /^[ ]*\t/.test(line)),
    );
    expect(tabbed, 'indent_style = space').toEqual([]);
  });

  it('is readable as utf-8', () => {
    // A byte sequence that is not valid UTF-8 decodes to U+FFFD, which re-encodes to three
    // different bytes — so a round trip that changes length is a file that is not what it says.
    const mojibake = GOVERNED.filter((path) => {
      const buffer = bytes(path);
      return Buffer.from(buffer.toString('utf8'), 'utf8').length !== buffer.length;
    });
    expect(mojibake, 'charset = utf-8').toEqual([]);
  });
});
