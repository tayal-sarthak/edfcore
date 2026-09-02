/**
 * `edfcore gaps` caps its listing and says what it withheld.
 *
 * Every other listing this CLI prints has always been capped: the diagnostics under `header` and
 * `validate`, and `events --list`. Each carries the same notice, and `cli-run.ts` says why beside
 * the events one — "a silently truncated listing reads as a complete one".
 *
 * The gap list was not, and it is the one with no bound. `signals` is bounded by the header's
 * signal count and the spec caps that at 9999; `events --list` and the diagnostics blocks were
 * capped from the start. A gap list is bounded only by the record count, so an ambulatory recorder
 * that stops and restarts every minute across a night produces hundreds of rows — which means the
 * command written for discontinuous files was the one that flooded on them.
 *
 * Capping a tab-separated output by default is not new here: `events --list` is tab-separated,
 * "for grep and awk", and has always stopped at twenty with a notice underneath. The two commands
 * behave the same way now, from the same constant, and `--limit 0` prints neither rows nor the
 * blank line above the notice — the shape 0.4.181 fixed once already.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf } from '../support/writer.js';

/** Sixty records, every other one displaced, so the scan finds twenty-nine gaps. */
const MANY_GAPS = buildEdf({
  plus: 'D',
  recordCount: 60,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => record + Math.floor(record / 2) * 10,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function gaps(argv: readonly string[]): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => MANY_GAPS,
  };
  expect(await runCli(parseArgs(['gaps', ...argv, 'a.edf']), io)).toBe(0);
  return chunks.join('');
}

const rows = (text: string): number =>
  text.split('\n').filter((line) => line.startsWith('after segment ')).length;

describe('the fixture', () => {
  it('has more gaps than the default cap, or nothing below means anything', async () => {
    const printed = await gaps(['--limit', '1000']);
    expect(rows(printed)).toBeGreaterThan(20);
    expect(printed).not.toContain('more (raise --limit');
  });
});

describe('with no --limit', () => {
  it('stops at the same twenty every other listing stops at', async () => {
    expect(rows(await gaps([]))).toBe(20);
  });

  it('says how many it withheld, and how to see them', async () => {
    const printed = await gaps([]);
    const notice = /\.\.\. (\d+) more \(raise --limit to see them\)/.exec(printed);
    expect(notice).not.toBeNull();
    // The count on the summary line and the rows plus the notice are the same number.
    const total = /^(\d+) gaps? in /m.exec(printed);
    expect(Number(notice?.[1]) + 20).toBe(Number(total?.[1]));
  });
});

describe('with --limit', () => {
  it('honours the number given', async () => {
    expect(rows(await gaps(['--limit', '3']))).toBe(3);
    expect(await gaps(['--limit', '3'])).toContain('more (raise --limit to see them)');
  });

  it('prints no rows and no hanging blank line at zero', async () => {
    const printed = await gaps(['--limit', '0']);
    expect(rows(printed)).toBe(0);
    expect(printed).toContain('more (raise --limit to see them)');
    expect(printed).not.toMatch(/\n\n\n/);
  });

  it('says nothing about withholding when the limit covers them all', async () => {
    expect(await gaps(['--limit', '1000'])).not.toContain('more (raise --limit');
  });
});

describe('what the cap did not change', () => {
  it('leaves the summary line counting every gap, not the printed ones', async () => {
    // The count above the rows is the file's answer; the rows are a page of it.
    const all = /^(\d+) gaps? in /m.exec(await gaps(['--limit', '1000']))?.[1];
    const capped = /^(\d+) gaps? in /m.exec(await gaps([]))?.[1];
    expect(capped).toBe(all);
  });

  it('leaves a file with no gaps saying so, with no notice under it', async () => {
    const clean = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    const chunks: string[] = [];
    const io: CliIo = {
      out: (text) => chunks.push(text),
      err: () => {},
      readFile: async () => clean,
    };
    await runCli(parseArgs(['gaps', 'a.edf']), io);
    expect(chunks.join('')).toBe('no gaps in 4 records\n');
  });

  it('keeps the four columns, so an existing cut still reads a duration', async () => {
    const row = (await gaps([])).split('\n').find((line) => line.startsWith('after segment '));
    expect(row?.split('\t')).toHaveLength(4);
  });
});
