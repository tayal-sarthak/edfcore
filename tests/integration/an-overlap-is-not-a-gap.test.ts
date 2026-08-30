/**
 * An overlap, at every surface that could call it a gap.
 *
 * This is the defect the changelog has fixed four times. An overlap travels in `index.gaps` with a
 * NEGATIVE duration — 0.2.69 decided that, and `api-reading.md` documents it — so every consumer of
 * that array has to branch on the sign, and each one that did not printed "a gap of -0.2 s": a gap
 * of negative duration, with an explanation that inverts what an overlap does. Across a gap two
 * samples are seconds APART; across an overlap they cover the SAME time, so concatenating
 * duplicates it rather than skipping it.
 *
 * 0.3.3 partitioned `edfcore gaps`. 0.3.33 applied the rule to "the two places that still said it
 * was". 0.3.41 found a third in `src/chunks.ts`, which contained no mention of an overlap at all.
 * 0.3.59 found a fourth forty lines below the third, on the branch a probed index actually reaches.
 * Each fix was local, and `merge-chunks.test.ts` covers the two in `chunks.ts`.
 *
 * What no test does is treat it as one rule over one file. So this drives a single overlapping
 * recording through every surface that reports a boundary and asserts the same two things at each:
 * the word `overlap` appears, and no negative magnitude is ever presented as a duration. The second
 * is the assertion that would have failed all four times — `gap of -0.2 s` is what the defect
 * looked like on screen, at every one of them.
 *
 * A blanket ban on the word "gap" would be wrong, and that is worth saying: the messages correctly
 * use it in the RULE they cite — "a discontinuous file may leave gaps between records but never
 * overlaps them" — which is the sentence that makes the diagnostic understandable. The check is
 * about how the observed boundary is described, not about a vocabulary.
 *
 * The sites are read out of `src/` so a fifth consumer of `index.gaps` fails here until it is
 * driven, which is the part that stops this being a fifth local fix.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** Five one-second records; record 3 starts 0.2 s before record 2 ends. */
const overlapping = (plus: 'C' | 'D'): Uint8Array =>
  buildEdf({
    plus,
    recordCount: 5,
    recordDurationSeconds: 1,
    recordOnsetSeconds: (record) => (record < 3 ? record : record - 0.2),
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    annotationSignals: [{ samplesPerRecord: 24 }],
  });

const OVERLAP_SECONDS = 0.2;

/**
 * The two assertions every surface has to pass.
 *
 * The negative-magnitude patterns are what the defect produced: a duration printed with its sign,
 * which is only ever reachable by forwarding `durationSeconds` without looking at it.
 */
function callsItAnOverlap(text: string, where: string): void {
  expect(text, where).toMatch(/overlap/i);
  expect(text, where).not.toMatch(/gap of -/i);
  expect(text, where).not.toMatch(/discontinuity of -/i);
  expect(text, where).not.toMatch(/-0\.2\s*s?\s*gap/i);
  // No magnitude anywhere in the prose carries a minus sign in front of the overlap's size.
  expect(text, where).not.toContain(`-${OVERLAP_SECONDS} s gap`);
}

async function opened(plus: 'C' | 'D'): Promise<EdfRecording> {
  return openEdf(byteSource(overlapping(plus)));
}

async function cliOutput(argv: readonly string[], bytes: Uint8Array): Promise<string> {
  let text = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(bytes),
    out: (piece) => {
      text += piece;
    },
    err: (piece) => {
      text += piece;
    },
  };
  await runCli(parseArgs(argv), io);
  return text;
}

describe('the file', () => {
  it('really does overlap, so every assertion below has something to describe', async () => {
    const recording = await opened('D');
    const index = await buildRecordIndex(recording);
    expect(index.gaps).toHaveLength(1);
    const [boundary] = index.gaps ?? [];
    // The negative duration is the representation everything below has to interpret.
    expect(boundary?.durationSeconds).toBe(-OVERLAP_SECONDS);
    expect(boundary?.durationTicks).toBeLessThan(0n);
  });
});

describe('the consumers of that negative duration', () => {
  function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
        continue;
      }
      if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
    }
    return into;
  }

  it('are the three modules driven below, and no others', () => {
    const src = new URL('../../src/', import.meta.url);
    const found = sourceFiles(src, '', [])
      .filter((name) => {
        const text = readFileSync(new URL(name, src), 'utf8');
        // A module that partitions a GAP's own duration by its sign in order to say which it
        // is. `biosemi.ts` compares a record duration to zero, which is a different question.
        return /\b(?:gap\.duration(?:Ticks|Seconds)|deltaTicks)\s*[<>]\s*0n?/.test(text);
      })
      .sort();
    expect(found).toEqual(['chunks.ts', 'cli-run.ts', 'validate.ts']);
  });
});

describe('mergeChunks', () => {
  it('names it an overlap on the precededByGap branch, which a scanned index reaches', async () => {
    const recording = await opened('D');
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const first = await readRecords(located, {
      records: { start: 0, count: 3 },
      signalIndices: [0],
    });
    const second = await readRecords(located, {
      records: { start: 3, count: 2 },
      signalIndices: [0],
    });

    let message = '';
    try {
      mergeChunks([first, second]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    callsItAnOverlap(message, 'mergeChunks (precededByGap)');
    expect(message).toContain(`overlap of ${OVERLAP_SECONDS} s`);
  });

  it('names it an overlap on the tick branch too, which is the one a probed index reaches', async () => {
    const recording = await opened('D');
    const first = await readRecords(recording, {
      records: { start: 0, count: 3 },
      signalIndices: [0],
    });
    const second = await readRecords(recording, {
      records: { start: 3, count: 2 },
      signalIndices: [0],
    });
    // A probed index fills in no gaps, so the first branch cannot fire here.
    expect(second.precededByGap).toBeUndefined();

    let message = '';
    try {
      mergeChunks([first, second]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    callsItAnOverlap(message, 'mergeChunks (ticks)');
    expect(message).toContain(`overlap of ${OVERLAP_SECONDS} s`);
  });
});

describe('the validation report', () => {
  it('calls the boundary an overlap in the diagnostic it raises', async () => {
    const recording = await opened('D');
    const report = await validateRecording(recording, { scanSamples: true });
    const text = formatValidationReport(report, { header: recording.header });
    callsItAnOverlap(text, 'formatValidationReport');
    expect(text).toContain(`overlap in time by ${OVERLAP_SECONDS} s`);
  });

  it('counts it as an overlap rather than a gap on a file that claims to be continuous', async () => {
    const recording = await opened('C');
    const report = await validateRecording(recording, { scanSamples: true });
    const text = formatValidationReport(report, { header: recording.header });
    callsItAnOverlap(text, 'formatValidationReport (EDF+C)');
    expect(text).toContain('1 overlap(s) between them');
    // And does not add a phantom gap to the count beside it.
    expect(text).not.toContain('1 gap(s) between them');
  });
});

describe('the CLI', () => {
  it('counts it as an overlap in the summary line', async () => {
    const text = await cliOutput(['gaps', 'a.edf'], overlapping('D'));
    callsItAnOverlap(text, 'edfcore gaps');
    expect(text).toContain('0 gap(s) and 1 overlap(s)');
  });

  it('labels the row itself, so a piped line says which it is', async () => {
    const text = await cliOutput(['gaps', 'a.edf'], overlapping('D'));
    const row = text.split('\n').find((line) => line.includes('\t'));
    expect(row).toBeDefined();
    expect(row?.split('\t').at(-1)).toBe('overlap');
  });
});

describe('the record probes at open', () => {
  it('report the drift as records starting before the previous one ends', async () => {
    const recording = await opened('D');
    const messages = recording.timeline.diagnostics.map((diagnostic) => diagnostic.message);
    expect(messages.length).toBeGreaterThan(0);
    const spacing = messages.find((message) => message.includes('net drift'));
    expect(spacing).toBeDefined();
    callsItAnOverlap(spacing ?? '', 'timeline diagnostics');
    expect(spacing).toContain('a record starts before the previous one ends');
  });

  it('still uses the word "gaps" for the rule it cites, which is correct and not the defect', async () => {
    const recording = await opened('D');
    const spacing = recording.timeline.diagnostics
      .map((diagnostic) => diagnostic.message)
      .find((message) => message.includes('net drift'));
    // The rule sentence is what makes the diagnostic understandable; the ban is on describing
    // THIS boundary as a gap, not on the vocabulary.
    expect(spacing).toContain('may leave gaps between records but never overlaps them');
  });
});
