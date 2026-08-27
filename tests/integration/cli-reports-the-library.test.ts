/**
 * What the CLI prints is what the library reports, over every awkward shape.
 *
 * `cli-unfamiliar-file.test.ts` checks the six commands survive these files. Surviving is not
 * agreeing: a command that caught its own exception and printed a plausible summary would pass
 * that and be worse than a crash, because the output is what a reader pastes into an issue.
 *
 * Three commands carry values rather than prose, and each is re-derived here from the library and
 * compared with what the command printed. They fail in three different ways. `json` is read by
 * scripts, so a field that quietly stops matching the header is acted on rather than noticed.
 * `events` prints a count and then a listing, and the two can disagree with each other as well as
 * with the file. `gaps` runs its own full scan — deliberately, since the probed index cannot see a
 * gap in the middle — so its numbers come from a second traversal that nothing compared with the
 * first.
 *
 * `signals` is not here: `cli-signals-columns.test.ts` ties all six of its columns to the header
 * already, which is the same check in the same shape.
 *
 * What this does NOT check: the layout — where the blank lines fall, how a count is worded.
 * `cli.test.ts` owns that. This checks that the numbers are the file's.
 */

import { describe, expect, it } from 'vitest';
// `trimEdfField` is internal — not part of the published surface — so it is imported from where
// `cli-run.ts` imports it rather than from the barrel.
import { trimEdfField } from '../../src/bytes/latin1.js';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { buildRecordIndex, byteSource, openEdf, readAnnotations } from '../../src/index.js';
import { AWKWARD } from '../support/awkward-files.js';

const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

async function output(argv: readonly string[], bytes: Uint8Array): Promise<string> {
  let out = '';
  const io: CliIo = {
    readFile: async () => bytes,
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  await runCli(parseArgs(argv), io);
  return out;
}

interface JsonSignal {
  readonly index: number;
  readonly label: string;
  readonly kind: string;
  readonly samplesPerRecord: number;
  readonly sampleRateHz?: number;
  readonly physicalDimension: string;
}

interface JsonReport {
  readonly variant: string;
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
  readonly spanSeconds: number;
  readonly patient?: string;
  readonly signals: readonly JsonSignal[];
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly severity: string }>;
}

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  it(`emits JSON that is the header, where ${awkward}`, async () => {
    const recording = await openEdf(byteSource(bytes));
    const { header, timeline } = recording;
    const report = JSON.parse(await output(['json', 'a.edf'], bytes)) as JsonReport;

    expect(report.variant).toBe(header.variant);
    expect(report.recordCount).toBe(header.recordCount);
    expect(report.recordDurationSeconds).toBe(header.recordDurationSeconds);
    expect(report.spanSeconds).toBe(timeline.spanSeconds);

    // Every signal, annotations channel included, in file order.
    expect(report.signals).toHaveLength(header.signals.length);
    for (const [position, signal] of header.signals.entries()) {
      const printed = report.signals[position];
      expect(printed?.index).toBe(signal.index);
      expect(printed?.label).toBe(signal.label);
      expect(printed?.kind).toBe(signal.kind);
      expect(printed?.samplesPerRecord).toBe(signal.samplesPerRecord);
      expect(printed?.physicalDimension).toBe(signal.physicalDimension);
      // `JSON.stringify` drops a key whose value is `undefined`, so an absent rate is an absent
      // KEY here rather than a null — which is what a script reading it has to expect on a legal
      // zero-duration file.
      expect(Object.hasOwn(printed ?? {}, 'sampleRateHz')).toBe(signal.sampleRateHz !== undefined);
      if (signal.sampleRateHz !== undefined)
        expect(printed?.sampleRateHz).toBe(signal.sampleRateHz);
    }

    // The diagnostics list is the header's, code and severity, in the order the header carries.
    expect(report.diagnostics).toEqual(
      header.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
      })),
    );

    // Identification is opt-in, and what --patient prints is the raw field with padding trimmed.
    expect(Object.hasOwn(report, 'patient')).toBe(false);
    const withPatient = JSON.parse(
      await output(['json', 'a.edf', '--patient'], bytes),
    ) as JsonReport;
    expect(withPatient.patient).toBe(trimEdfField(header.patient.raw));
  });

  it(`counts and lists the annotations the library reads, where ${awkward}`, async () => {
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });

    const counted = await output(['events', 'a.edf'], bytes);
    if (annotations.length === 0) {
      expect(counted.trim()).toBe('no annotations');
      return;
    }
    expect(counted.split(NEWLINE)[0]).toBe(`${annotations.length} annotation(s)`);

    // The listing is the same events on the same axis, one row each.
    const listed = await output(['events', 'a.edf', '--list'], bytes);
    const rows = listed
      .split(NEWLINE)
      .filter((line) => line.includes(TAB))
      .map((line) => line.split(TAB));
    expect(rows).toHaveLength(annotations.length);
    for (const [position, event] of annotations.entries()) {
      const row = rows[position];
      expect(row?.[0], event.text).toBe(String(event.onsetSecondsFromFirstRecord));
      expect(row?.[1]).toBe(
        event.durationSeconds === undefined ? '' : String(event.durationSeconds),
      );
      expect(row?.[2]).toBe(event.text);
    }
  });

  it(`reports the gaps a full scan finds, where ${awkward}`, async () => {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const gaps = index.gaps ?? [];

    const printed = await output(['gaps', 'a.edf'], bytes);
    if (gaps.length === 0) {
      expect(printed.trim()).toBe(`no gaps in ${index.recordCount} records`);
      return;
    }

    // A gap is time no record covers; an overlap is one instant two records both claim. They
    // travel in one array, told apart by the sign of the duration, and the count line says so.
    const overlaps = gaps.filter((gap) => gap.durationSeconds < 0).length;
    const expected =
      overlaps === 0
        ? `${gaps.length} gap(s) in ${index.recordCount} records`
        : `${gaps.length - overlaps} gap(s) and ${overlaps} overlap(s) in ${index.recordCount} records`;
    expect(printed.split(NEWLINE)[0]).toBe(expected);

    const rows = printed
      .split(NEWLINE)
      .filter((line) => line.startsWith('after segment'))
      .map((line) => line.split(TAB));
    expect(rows).toHaveLength(gaps.length);
    for (const [position, gap] of gaps.entries()) {
      const row = rows[position];
      expect(row?.[0]).toBe(`after segment ${gap.beforeSegmentIndex}`);
      expect(row?.[1]).toBe(`${gap.startSeconds}s..${gap.endSeconds}s`);
      expect(row?.[3]).toBe(gap.durationSeconds < 0 ? 'overlap' : 'gap');
    }
  });
});

describe('the shapes reached each branch', () => {
  it('include a file with events, one without, and one with a gap', async () => {
    let withEvents = 0;
    let withGaps = 0;
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      const { annotations } = await readAnnotations(recording, {
        start: 0,
        count: recording.header.recordCount,
      });
      if (annotations.length > 0) withEvents += 1;
      const index = await buildRecordIndex(recording);
      if ((index.gaps ?? []).length > 0) withGaps += 1;
    }
    expect(withEvents).toBeGreaterThanOrEqual(3);
    expect(withEvents).toBeLessThan(AWKWARD.length);
    expect(withGaps).toBeGreaterThanOrEqual(1);
  });
});
