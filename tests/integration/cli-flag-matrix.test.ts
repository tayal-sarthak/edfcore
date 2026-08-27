/**
 * "Each is accepted and ignored by the commands it does not name."
 *
 * `cli.md` names three flags, says which commands each one is for, and then makes that one
 * sentence about all the other pairs. It is the sentence that lets a wrapper script pass a fixed
 * flag set to every command instead of branching, and it is the only claim on the page that is
 * about pairs rather than about a command — thirteen of them, none checked.
 *
 * Both halves can rot silently. "Accepted" fails loudly enough — `parseArgs` refuses an unknown
 * flag, so a flag removed from the parser exits 2. "Ignored" does not: a flag that started
 * changing output would only show up as different bytes on a command nobody thought to pass it
 * to. `--patient` is the one that matters, because the thing it gates is identification, and the
 * failure direction is printing it when it was not asked for.
 *
 * The last clause — "the counted `events` output is never capped" — is the same test in the same
 * shape. `--limit` names `events --list`, so the counted listing must come back identical with a
 * limit of 1 as without it. A cap there would truncate a census, which reads as a complete one.
 *
 * The pairs are derived from the page's own sentence rather than listed here, so a flag that
 * gains or loses a command in the prose changes what is checked.
 *
 * What this does NOT check: that a flag DOES something for the commands it does name. That is
 * `cli.test.ts` (`--patient`) and `cli-limit-default.test.ts` (`--limit`).
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('cli.md') ?? '';

/** Every command the page's synopsis block offers, in the order it offers them. */
const COMMANDS: readonly string[] = (() => {
  const found = [...PAGE.matchAll(/^npx edfcore ([a-z]+) <file>/gm)].map((match) => match[1] ?? '');
  if (found.length === 0) throw new Error('cli.md no longer lists the commands');
  return found;
})();

/**
 * The commands each flag names, read out of the "Flags:" paragraph. `events --list` is written
 * that way in the prose, so the command is taken as the first word of each entry.
 */
const NAMED_BY: ReadonlyMap<string, readonly string[]> = (() => {
  const at = PAGE.indexOf('Flags: ');
  if (at === -1) throw new Error('cli.md no longer has a Flags paragraph');
  const paragraph = PAGE.slice(at, PAGE.indexOf('\n\n', at));
  const map = new Map<string, readonly string[]>();
  for (const match of paragraph.matchAll(/`(--[a-z]+)[^`]*`[^(]*\(([^)]*)\)/g)) {
    const commands = (match[2] ?? '')
      .split(',')
      .map((entry) => entry.trim().replaceAll('`', '').split(' ')[0] ?? '')
      .filter((entry) => entry.length > 0);
    map.set(match[1] ?? '', commands);
  }
  // `--list` names `events` without a parenthesised list, because the sentence about it says so.
  if (!map.has('--list')) map.set('--list', ['events']);
  return map;
})();

/** EDF+D with annotations, a gap, and a header defect, so every command prints something. */
const FILE = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (recordIndex) => (recordIndex < 2 ? recordIndex : recordIndex + 5),
  patientId: 'packed-into-one-token',
  signals: [{ label: 'Fp1', samplesPerRecord: 8, physicalDimension: 'uV' }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (recordIndex) => [
        { onset: recordIndex, texts: [`event ${recordIndex % 2}`] },
        { onset: recordIndex + 0.5, texts: ['Sleep stage W'] },
      ],
    },
  ],
});

async function invoke(argv: readonly string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const io: CliIo = {
    readFile: async () => FILE,
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const code = await runCli(parseArgs(argv), io);
  return { code, out };
}

describe('the page still makes the claim these tests are about', () => {
  it('says the flags are accepted and ignored elsewhere', () => {
    expect(PAGE).toContain('Each is accepted and ignored by the commands it does not name');
    expect(PAGE).toContain('the counted `events` output is never capped');
  });

  it('reads a flag table with something in it, so the matrix below is not empty', () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(6);
    expect([...NAMED_BY.keys()].sort()).toEqual(['--limit', '--list', '--patient']);
    for (const commands of NAMED_BY.values()) expect(commands.length).toBeGreaterThan(0);
  });
});

describe('a flag a command does not name', () => {
  const pairs: Array<[string, string, readonly string[]]> = [];
  for (const [flag, named] of NAMED_BY) {
    for (const command of COMMANDS) {
      if (named.includes(command)) continue;
      pairs.push([flag, command, flag === '--limit' ? [flag, '1'] : [flag]]);
    }
  }

  it('leaves at least ten pairs to check', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(10);
  });

  for (const [flag, command, argv] of pairs) {
    it(`${command} accepts ${flag} and prints exactly what it prints without it`, async () => {
      const plain = await invoke([command, 'a.edf']);
      const flagged = await invoke([command, 'a.edf', ...argv]);
      expect(flagged.code, `${command} ${flag} changed the exit code`).toBe(plain.code);
      expect(flagged.out, `${command} ${flag} changed the output`).toBe(plain.out);
    });
  }
});

describe('the counted events listing', () => {
  it('is never capped, however small the limit', async () => {
    const plain = await invoke(['events', 'a.edf']);
    const capped = await invoke(['events', 'a.edf', '--limit', '1']);
    expect(capped.out).toBe(plain.out);
  });

  it('had more than one line to cap, so the check is not vacuous', async () => {
    const plain = await invoke(['events', 'a.edf']);
    expect(plain.out.trim().split('\n').length).toBeGreaterThan(2);
  });

  it('is capped when --list turns it into a listing, which is the pair this contrasts with', async () => {
    const listed = await invoke(['events', 'a.edf', '--list']);
    const capped = await invoke(['events', 'a.edf', '--list', '--limit', '1']);
    expect(capped.out).not.toBe(listed.out);
  });
});
