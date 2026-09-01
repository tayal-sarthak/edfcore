/**
 * How much the CLI prints when you do not say — one number, stated in five places.
 *
 * `--limit` caps the diagnostics or events a command prints. Leave it off and you get twenty, and
 * twenty is what the usage text promises, what the error message for a bad `--limit` offers as the
 * way back, what the README tells a reader before they install anything, and what `cli.md`
 * repeats. Until 0.4.390 it was also the literal `20` at four separate call sites inside
 * `cli-run.ts`, which is the shape of number that ends up meaning two different things — `header`
 * printing twenty diagnostics while `events --list` prints fifty, with both pages still saying
 * twenty.
 *
 * That is now `DEFAULT_ITEM_LIMIT`, and this checks the number the CLI actually applies rather
 * than the constant: each command is run over a file with far more to print than the cap, and the
 * lines are counted. The prose is then checked against what was counted.
 *
 * The README spells it as a word — "print twenty at a time" — which is why the mapping below
 * exists. A numeral there would read like a flag value rather than a sentence, and prose is what
 * the first screen of the README is.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

// Collapsed, because the sentence wraps in the file and the wrap is not the claim.
const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replace(
  /\s+/g,
  ' ',
);
const CLI_PAGE = (DOCS_PAGES.get('cli.md') ?? '').replace(/\s+/g, ' ');

/** Round numbers a print cap could plausibly be, spelled the way prose spells them. */
const WORDS: ReadonlyMap<number, string> = new Map([
  [10, 'ten'],
  [20, 'twenty'],
  [25, 'twenty-five'],
  [50, 'fifty'],
  [100, 'a hundred'],
]);

/** Sixty events, in a file whose header is otherwise unremarkable. */
const MANY_EVENTS = minimalEdfPlus({
  recordCount: 60,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (record) => [{ onset: record + 0.5, texts: [`event ${record}`] }],
    },
  ],
});

/** The cap the CLI applied, counted from a listing of sixty events with no `--limit` given. */
async function observeDefault(): Promise<number> {
  const out = await invoke(['events', 'night.edf', '--list']);
  return out.split('\n').filter((line) => line.includes('\tevent ')).length;
}

async function invoke(argv: readonly string[]): Promise<string> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(MANY_EVENTS),
    out: (text) => {
      out += text;
    },
    err: () => undefined,
  };
  await runCli(parseArgs(argv), io);
  return out;
}

describe('the number the CLI applies', () => {
  it('caps a listing at the default when no --limit is given', async () => {
    const out = await invoke(['events', 'night.edf', '--list']);
    // One tab-separated line per event, after the count line and the blank line under it.
    const rows = out.split('\n').filter((line) => line.includes('\tevent '));
    // The one place in this file that names the number. Everything below derives it from here, so
    // a deliberate change to the cap lands on this line and nowhere else.
    expect(rows).toHaveLength(20);
    // And the file really had more, so the cap is what stopped it rather than the fixture.
    expect(out).toContain('60 annotations');
  });

  it('is the same number --limit sets explicitly', async () => {
    const capped = await invoke([
      'events',
      'night.edf',
      '--list',
      '--limit',
      String(await observeDefault()),
    ]);
    const defaulted = await invoke(['events', 'night.edf', '--list']);
    expect(capped).toBe(defaulted);
  });
});

describe('and the places that state it', () => {
  // Every one of these is checked against the number the CLI just applied, not against a literal
  // written here: raising the cap and updating the pages should pass, raising it and forgetting
  // one of them should not.

  it('is what the usage text promises', async () => {
    const help = await invoke(['--help']);
    expect(help).toContain(`default ${await observeDefault()}`);
  });

  it('is what a bad --limit offers as the way back', async () => {
    const error = (() => {
      try {
        parseArgs(['--limit', 'all', 'header', 'night.edf']);
        return undefined;
      } catch (thrown) {
        return thrown as Error;
      }
    })();
    expect(error?.message).toContain(`the default of ${await observeDefault()}`);
  });

  it('is what the README and cli.md tell a reader', async () => {
    const observed = await observeDefault();
    const word = WORDS.get(observed);
    expect(word, `no spelling recorded for ${observed}`).toBeDefined();
    expect(README).toContain(`print ${word} at a time`);
    // The page states the flag rather than the number, so what is checked there is that it still
    // describes a cap at all — the number lives in the README and in `--help`.
    expect(CLI_PAGE).toContain('`--limit <n>` caps the');
  });
});
