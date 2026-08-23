/**
 * `edfcore validate` exiting 1 for a file that failed validation, and 0 for one that only worries.
 *
 * The exit-code table on `cli.md` gives `1` two meanings in one row: "the file could not be read,
 * **or validation failed**". `documented-exit-codes.test.ts` proves the first half — a missing file
 * exits 1 — and the second half, which is the entire reason the command exists, was never
 * exercised. `runCli` returns `report.ok ? 0 : 1`, and nothing had ever driven it down the `false`
 * side.
 *
 * A CI job gating on conformance is the documented use, and it branches on this number without
 * reading a word of the output. Two failures are available and they are opposite:
 *
 *  - The gate never fires. Every recording passes, including the ones the library refused to
 *    scale, and the job's green tick means nothing — which nobody investigates, because a passing
 *    check is not a symptom.
 *  - The gate always fires. Then it is turned off, and the conformance checking goes with it.
 *
 * The second is the likelier one, and it turns on a boundary this file states as its subject: a
 * WARNING is not a failure. `LABEL_CONVENTION_NONCONFORMANT` is on almost every real recording;
 * CHB-MIT ships a duplicated channel label; a file marked EDF+C whose onsets drift is a warning
 * because that is a thing real writers do; a zero record duration is legal EDF. A gate that
 * rejected any of those would reject the corpus this library was built to read, and would be
 * switched off within a day.
 *
 * `header` on the same refused file is checked too, and exits 0. It reports what the header says
 * and adjudicates nothing, so a caller who wants a verdict has to ask for one — which is what
 * makes the verdict worth having.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, CliUsageError, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const CLI_PAGE = readFileSync(
  new URL('../../website/src/content/docs/cli.md', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ');

const one = (label: string, overrides = {}): Uint8Array =>
  buildEdf({
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label, samplesPerRecord: 8 }],
    ...overrides,
  });

/** Digital minimum equal to digital maximum: no gain can be derived, and that is an error. */
const REFUSED = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8, digitalMinimum: 100, digitalMaximum: 100 }],
});

/** Shapes real writers emit. Every diagnostic they raise is a warning or an info. */
const WORRYING: ReadonlyMap<string, Uint8Array> = new Map([
  [
    'a duplicated channel label, which CHB-MIT ships',
    buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [
        { label: 'T8-P8', samplesPerRecord: 8 },
        { label: 'T8-P8', samplesPerRecord: 8 },
      ],
    }),
  ],
  [
    'onsets that drift in a file marked continuous',
    minimalEdfPlus({
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (at: number) => (at < 2 ? at : at + 3),
    }),
  ],
  ['records that occupy no time, which is legal EDF', one('Fp1', { recordDurationSeconds: 0 })],
  ['a start date that names no real day', one('Fp1', { raw: { startDate: '32.13.99' } })],
]);

async function exitCodeOf(argv: readonly string[], bytes?: Uint8Array): Promise<number> {
  const io: CliIo = {
    readFile: (path) =>
      bytes === undefined
        ? Promise.reject(new Error(`ENOENT: no such file, open '${path}'`))
        : Promise.resolve(bytes),
    out: () => {},
    err: () => {},
  };
  try {
    return await runCli(parseArgs(argv), io);
  } catch (error) {
    return error instanceof CliUsageError ? 2 : 1;
  }
}

describe('the row that gives 1 two meanings', () => {
  it('still says both of them', () => {
    expect(CLI_PAGE).toContain('the file could not be read, or validation failed');
  });

  it('means it about a file that could not be read', async () => {
    expect(await exitCodeOf(['validate', 'missing.edf'])).toBe(1);
  });

  it('means it about a file that failed validation', async () => {
    // Readable, parseable, and refused: the header declares a digital range of a single point,
    // so no gain exists and `toPhysical` cannot run. That is an error, not a worry.
    expect(await exitCodeOf(['validate', 'refused.edf'], REFUSED)).toBe(1);
  });
});

describe('a warning is not a failure', () => {
  it.each([...WORRYING.entries()])('exits 0 for %s', async (_why, bytes) => {
    expect(await exitCodeOf(['validate', 'file.edf'], bytes)).toBe(0);
  });

  it('exits 0 for a file with nothing to say about it either', async () => {
    expect(await exitCodeOf(['validate', 'clean.edf'], minimalEdfPlus({ recordCount: 4 }))).toBe(0);
  });

  it('is the boundary the codes themselves draw, not a property of these fixtures', async () => {
    // The rule behind every row above: the verdict is "no diagnostic of error severity", so a new
    // code promoted to `error` changes what the gate rejects, and a demoted one changes it back.
    const io: CliIo = {
      readFile: () => Promise.resolve(REFUSED),
      out: () => {},
      err: () => {},
    };
    let printed = '';
    await runCli(parseArgs(['validate', 'refused.edf']), {
      ...io,
      out: (text) => {
        printed += text;
      },
    });
    expect(printed).toContain('FAIL');
    expect(printed).toMatch(/\b1 error\b/);
  });
});

describe('and the command that adjudicates nothing', () => {
  it('exits 0 for the same refused file, because header only reports', async () => {
    expect(await exitCodeOf(['header', 'refused.edf'], REFUSED)).toBe(0);
    // Which is what makes asking for a verdict worth doing.
    expect(await exitCodeOf(['validate', 'refused.edf'], REFUSED)).toBe(1);
  });
});
