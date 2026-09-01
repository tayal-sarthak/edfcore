/**
 * `--help` and `cli.md` describe the same flags.
 *
 * The COMMANDS are checked three ways — `api-surface.test.ts` counts the `--help` list against the
 * README's table, `cli-command-list.test.ts` asserts `--help` offers exactly what the dispatch
 * switch handles, and `documented-cli.test.ts` runs every `npx edfcore …` written across the docs.
 * The FLAGS had half that. `cli-flag-matrix.test.ts` reads the page's "Flags:" paragraph and
 * checks that a command a flag does not name ignores it, which compares the page with the
 * behaviour; nothing compared the page with the help text.
 *
 * So the two drifted on the change that made them differ. 0.6.7 made `--patient` gate both
 * identification fields rather than one, and updated the page. `--help` went on saying "include
 * patient identification" — which is the EDF field's name, and now names half of what the flag
 * does, in the one piece of documentation that ships inside the binary and is read by people who
 * never open a website.
 *
 * The check is the set of flags and, for each, the set of commands it names. Wording is not
 * checked and should not be: the page has paragraphs and `--help` has a column, and forcing them
 * to match word for word would make one of them worse. What has to agree is which flags exist and
 * which commands each applies to, because those are the two things a reader acts on.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('cli.md') ?? '';

async function help(): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => new Uint8Array(0),
  };
  expect(await runCli(parseArgs(['--help']), io)).toBe(0);
  return chunks.join('');
}

/** The flags `--help` lists, each with the commands named in its parenthesised list. */
function fromHelp(text: string): ReadonlyMap<string, readonly string[]> {
  const options = text.slice(text.indexOf('\nOptions\n'));
  const map = new Map<string, readonly string[]>();
  // A flag's entry runs to the next flag, so `--limit`'s wrapped second line belongs to it.
  const starts = [...options.matchAll(/^ {2}(--[a-z]+)/gm)];
  for (const [position, start] of starts.entries()) {
    const from = start.index ?? 0;
    const to = starts[position + 1]?.index ?? options.length;
    const entry = options.slice(from, to);
    const list = /\(([^)]*)\)/.exec(entry);
    map.set(
      start[1] as string,
      (list?.[1] ?? '')
        .split(',')
        .map((one) => (one.trim().split(/\s+/)[0] ?? '').trim())
        .filter((one) => one.length > 0),
    );
  }
  return map;
}

/** The same, from the page's "Flags:" paragraph, where the commands are backticked. */
function fromPage(): ReadonlyMap<string, readonly string[]> {
  const at = PAGE.indexOf('Flags: ');
  if (at === -1) throw new Error('cli.md no longer has a Flags paragraph');
  const paragraph = PAGE.slice(at, PAGE.indexOf('\n\n', at));
  const starts = [...paragraph.matchAll(/`(--[a-z]+)/g)];
  const map = new Map<string, readonly string[]>();
  for (const [position, start] of starts.entries()) {
    const from = start.index ?? 0;
    const to = starts[position + 1]?.index ?? paragraph.length;
    const segment = paragraph.slice(from, to);
    const list = /\(([^)]*`[^)]*)\)/.exec(segment);
    // `--list` is written in prose rather than with a parenthesised list — "`--list` makes
    // `events` print one event per line" — so the command is the first backticked word after the
    // flag, which is how `cli-flag-matrix.test.ts` reads the same paragraph.
    const named = [
      ...(list?.[1] ?? segment.slice(start[1]?.length ?? 0)).matchAll(/`([a-z]+)[^`]*`/g),
    ].map((one) => one[1] as string);
    map.set(start[1] as string, list === null ? named.slice(0, 1) : named);
  }
  return map;
}

/** `--help` and `--version` are how you ask, not things a command does. */
const NOT_PER_COMMAND = new Set(['--help', '--version']);

describe('both lists were found', () => {
  it('read a flag each, so a passing run is not a vacuous one', async () => {
    expect([...fromHelp(await help()).keys()]).toContain('--patient');
    expect([...fromPage().keys()]).toContain('--patient');
    expect(fromPage().get('--patient')).toEqual(['header', 'validate', 'json']);
  });
});

describe('the flags', () => {
  it('are the same set in --help and on the page', async () => {
    const inHelp = [...fromHelp(await help()).keys()].filter((one) => !NOT_PER_COMMAND.has(one));
    expect(inHelp.sort()).toEqual([...fromPage().keys()].sort());
  });

  it('name the same commands in both', async () => {
    const listed = fromHelp(await help());
    for (const [flag, commands] of fromPage()) {
      expect({ flag, commands: [...(listed.get(flag) ?? [])].sort() }).toEqual({
        flag,
        commands: [...commands].sort(),
      });
    }
  });

  it('do not describe --patient as one field, which is what it stopped being', async () => {
    // The specific drift, kept as its own case: the set check above would pass on the old wording,
    // because what changed was what the flag does rather than which commands it reaches.
    const line = (await help()).split('\n').find((one) => one.trim().startsWith('--patient'));
    expect(line).toBeDefined();
    expect(line).not.toContain('patient identification');
    expect(line).toContain('both identification fields');
  });
});
