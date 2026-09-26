/**
 * `--limit ""`, which `Number()` reads as zero rather than as nothing.
 *
 * The guard beside this one refuses `NaN` because it "would disable the cap silently, which is the
 * opposite of what was asked for", and refuses a negative because `-1` is a whole number and naming
 * only that half "described a rule the rejected input satisfied". An empty string is the same
 * accident — a value meant to be there and missing — and `Number('')` is `0`, so it landed on the
 * other extreme and printed no rows at all.
 *
 * It is the shape a shell produces rather than one anyone types. `edfcore events "$f" --limit
 * "$LIMIT"` with `LIMIT` unset hands the parser exactly one empty argument; unquoted it would
 * vanish and leave `--limit` last, which the existing check already refuses by name. So the quoted
 * form — the one a careful script writer uses — was the one that read as zero.
 *
 * `--limit 0` is unchanged. It is a real request for the counts without the rows, and the output
 * still says how to widen it.
 *
 * Bad usage, so it is a `CliUsageError` and exits 2, which `cli.md` documents as "bad flag value".
 */

import { describe, expect, it } from 'vitest';
import { CliUsageError, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 120, tals: (r) => [{ onset: r + 0.25, texts: [`e${r}`] }] },
  ],
});

const refusal = (argv: readonly string[]): Error => {
  let thrown: Error | undefined;
  try {
    parseArgs(argv);
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

async function ran(argv: readonly string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const io = {
    readFile: () => Promise.resolve(FILE),
    out: (text: string) => lines.push(text),
    err: (text: string) => lines.push(text),
  };
  const code = await runCli(parseArgs(argv), io as never);
  return { code, text: lines.join('') };
}

describe('a blank --limit', () => {
  it.each([
    ['empty', ''],
    ['one space', ' '],
    ['a tab', '\t'],
  ])('is refused rather than read as zero, when %s', (_shape, written) => {
    const thrown = refusal(['events', 'a.edf', '--limit', written]);
    expect(thrown).toBeInstanceOf(CliUsageError);
    expect(thrown.message).toContain('--limit was given a blank value');
  });

  it('names the shell shape that produces it', () => {
    const thrown = refusal(['events', 'a.edf', '--limit', '']);
    expect(thrown.message).toContain('an unset shell variable in quotes arrives this way');
    expect(thrown.message).toContain('reads as zero rather than as the default');
  });

  it('still points at the default', () => {
    const thrown = refusal(['events', 'a.edf', '--limit', '']);
    expect(thrown.message).toContain('omit --limit for the default of');
  });

  it('is bad usage, which the exit code contract calls 2', async () => {
    // `runCli` never sees it: `parseArgs` throws, and `cli.ts` maps CliUsageError to 2.
    expect(refusal(['events', 'a.edf', '--limit', ''])).toBeInstanceOf(CliUsageError);
  });
});

describe('what it used to do', () => {
  it('is what --limit 0 still does, which is a real request', async () => {
    const zero = await ran(['events', 'a.edf', '--list', '--limit', '0']);
    expect(zero.code).toBe(0);
    expect(zero.text).toContain('4 annotations');
    expect(zero.text).toContain('raise --limit to see them');
    expect(zero.text).not.toContain('e0');
  });
});

describe('every other spelling keeps its answer', () => {
  // This one did NOT keep its answer, and the heading was the reason to look. It was written here
  // as "by name", and the name the generic branch gave a value nobody typed was `undefined`.
  // 0.6.255 gave the missing value its own sentence, the way the blank one has had since 0.6.246.
  it('refuses a missing value as missing, rather than printing one', () => {
    expect(refusal(['events', 'a.edf', '--limit']).message).toContain('no value at all');
    expect(refusal(['events', 'a.edf', '--limit']).message).not.toContain('undefined');
  });

  it.each([
    ['a word', 'all'],
    ['a negative', '-1'],
    ['a fraction', '1.5'],
    ['a filename that followed the flag', 'a.edf'],
  ])('refuses %s by name', (_shape, written) => {
    const thrown = refusal(['events', 'a.edf', '--limit', written]);
    expect(thrown.message).toContain('--limit needs a non-negative whole number');
    expect(thrown.message).toContain(`received ${written}`);
  });

  it.each([
    ['a count', '5', 5],
    ['zero', '0', 0],
    ['a padded count', ' 5 ', 5],
  ])('still accepts %s', (_shape, written, expected) => {
    expect(parseArgs(['events', 'a.edf', '--limit', written]).limit).toBe(expected);
  });

  it('still lists every event when no limit is given', async () => {
    const all = await ran(['events', 'a.edf', '--list']);
    expect(all.text).toContain('e0');
    expect(all.text).toContain('e3');
  });
});
