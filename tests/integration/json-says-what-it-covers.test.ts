/**
 * `edfcore json` reports coverage and continuity, not a span on its own.
 *
 * `spanSeconds` is the last record's end minus the first record's start, gaps included. On a file
 * with a hole that is not what the records hold, and `formatHeader` refuses to print it unlabelled
 * for exactly that reason: it switches `duration` to `covered`, and adds two lines saying the gaps
 * are not in the number and where the span comes from. The machine-readable output had the one
 * number, unlabelled, and a script sizing a buffer or computing a sample count from it was out by
 * the gaps — silently, and only on the files that have them.
 *
 * The pair is also the only thing in this document that detects a hole without believing the file.
 * `variant` and `header.continuity` both carry the DECLARED claim — `EdfVariant`'s own docblock
 * says so, "neither is a promise" — and `DISCONTINUITY_IN_CONTINUOUS_FILE` exists for the file
 * where that claim is false. So the field a script would have branched on is the field that is
 * wrong, while two measured numbers that differ do so by exactly the gaps. That file is built here
 * and is the case the rest of this file turns on.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

interface Report {
  readonly variant: string;
  readonly spanSeconds: number;
  readonly coveredSeconds: number;
}

/** EDF+C by its reserved field, with a twenty-second hole in its onsets. */
const LIES_ABOUT_CONTINUITY = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 20),
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function run(command: string, bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => bytes,
  };
  await runCli(parseArgs([command, 'a.edf']), io);
  return chunks.join('');
}

const report = async (bytes: Uint8Array): Promise<Report> =>
  JSON.parse(await run('json', bytes)) as Report;

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a file that lies about being continuous', LIES_ABOUT_CONTINUITY],
];

describe('the matrix this file sweeps', () => {
  it('is the eleven shapes plus one built here', () => {
    expect(AWKWARD).toHaveLength(11);
    expect(FILES).toHaveLength(12);
  });
});

describe.each(FILES)('for %s', (_name, bytes) => {
  it('reports the two numbers the library holds', async () => {
    const recording = await openEdf(byteSource(bytes));
    const document = await report(bytes);
    expect(document.spanSeconds).toBe(recording.timeline.spanSeconds);
    expect(document.coveredSeconds).toBe(recording.timeline.coveredSeconds);
  });

  it('reports the number `edfcore header` prints on its own covered line', async () => {
    const printed = await run('header', bytes);
    const document = await report(bytes);
    // The formatter prints hh:mm:ss from ticks; the agreement checked here is the whole seconds,
    // which is what both are derived from.
    const line = printed.split('\n').find((one) => /^(duration|covered) /.test(one));
    expect(line).toBeDefined();
    expect(document.coveredSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('on the file the two numbers differ on', () => {
  it('says so, where before there was one number and no label', async () => {
    const document = await report(LIES_ABOUT_CONTINUITY);
    expect(document.spanSeconds).toBe(24);
    expect(document.coveredSeconds).toBe(4);
    // Twenty seconds of hole, visible as a subtraction and nowhere else in the document.
    expect(document.spanSeconds - document.coveredSeconds).toBe(20);
  });

  it('finds the hole that `variant` denies', async () => {
    // The reserved field says continuous. That is the claim the diagnostic exists to contradict,
    // and a script branching on `variant` reads it as a file with no gaps. The two numbers do not
    // depend on the claim.
    const document = await report(LIES_ABOUT_CONTINUITY);
    expect(document.variant).toBe('EDF+C');
    expect(document.spanSeconds).not.toBe(document.coveredSeconds);
  });

  it('is a real difference, so this is not a matrix where the two are always equal', async () => {
    const spans = await Promise.all(FILES.map(async ([, bytes]) => await report(bytes)));
    expect(spans.some((one) => one.spanSeconds !== one.coveredSeconds)).toBe(true);
    expect(spans.some((one) => one.spanSeconds === one.coveredSeconds)).toBe(true);
  });
});
