/**
 * The last program on `annotations.md`, run.
 *
 * That page ends with the conversion it exists to teach: an event onset to a sample index, in
 * integers, because `Math.round(onset * sampleRateHz)` drifts and the rate is `undefined` outright
 * when the record duration is zero. It is thirty lines, it prints two lines of output, and it is
 * the thing a reader copies. `annotations-page.test.ts` runs the TOP of the page — the region's
 * header fields, the four-event transcript, the read cost — and stops before this.
 *
 * The two printed lines are the whole test. `Sleep stage W 256n 0.007629510948348211` says the
 * onset was rebased onto the record-0 axis, converted through a bigint multiply and a floored
 * divide, split into a record and an offset, read, and scaled — and that every one of those steps
 * agreed with the next. The float is not decoration either: it is `bitValue * (offset + 0)` on a
 * ±500 µV signal against the standard 16-bit digital range, which is what a sample at a record
 * boundary decodes to, and it is printed twice because both events land on one.
 *
 * The fixture is the page's own file, reconstructed from the numbers the page already prints
 * elsewhere on it: `region.recordByteOffset` is 768, so the data signals hold 384 samples of two
 * bytes per record, and the worked example's `256n` at one second fixes `EEG Fpz-Cz` at 256 of
 * them. 128 remain, which is the second channel the page's own `matchSignals` example implies. So
 * the same file produces the transcript at the top and the two lines at the bottom, and the test
 * asserts both against text read out of the page.
 *
 * Four claims in the prose under the program are checked with it, because each is a step a reader
 * is being told to trust: the `floorDiv` the page tells you to write is the one edfcore uses; the
 * `firstSampleIndex` check step 4 recommends actually holds; the floor "matters for negative
 * onsets" in the direction the page says; and the Warning at the end is true — on an EDF+D file
 * the formula gives a position on the time axis that `index.locate` disagrees with.
 *
 * What this does NOT check: the two onset conventions, the `@@channel` split, or the encoding
 * fallback. Those are `annotation-timebase.test.ts` and the TAL grammar tests.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfRecording, EdfSignal } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('annotations.md') ?? '';

/**
 * The page's file. Every number here is one the page states: 1-second records, `EEG Fpz-Cz` at
 * 256 samples a record, a 60-sample annotation region, and the four events of the transcript.
 * `sample: (_record, index) => index` makes each record's first sample digital zero, which is what
 * the printed float is the physical value of.
 */
const PAGE_FILE = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 256, sample: (_record, index) => index },
    { label: 'EEG Pz-Oz', samplesPerRecord: 128, sample: (_record, index) => index },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (record) =>
        record === 0
          ? [
              { onset: '-0.75', texts: ['pre-stimulus baseline'] },
              { onset: '+1', duration: 30, texts: ['Sleep stage W'] },
            ]
          : record === 1
            ? [
                { onset: '+1.25', texts: ['spike'] },
                { onset: '+2', duration: 30, texts: ['Sleep stage 1'] },
              ]
            : [],
    },
  ],
});

/** The four lines of the program the page prints, transcribed. Nothing here is edfcore's. */
function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b === 0n || a > 0n ? quotient : quotient - 1n;
}

interface Printed {
  readonly text: string;
  readonly sampleIndex: bigint;
  readonly microvolts: number;
  readonly firstSampleIndex: number;
}

/** The program, verbatim apart from `console.log` becoming a returned array. */
async function runWorkedExample(
  recording: EdfRecording,
  signal: EdfSignal,
): Promise<readonly Printed[]> {
  const { header, timeline } = recording;
  const { annotations } = await readAnnotations(recording, {
    start: 0,
    count: header.recordCount,
  });

  function sampleIndexOf(onsetTicks: bigint): bigint {
    const elapsedTicks = onsetTicks - timeline.startOffsetTicks;
    return floorDiv(elapsedTicks * BigInt(signal.samplesPerRecord), header.recordDurationTicks);
  }

  const printed: Printed[] = [];
  for (const event of annotations) {
    if (!event.text.startsWith('Sleep stage')) continue;

    const sampleIndex = sampleIndexOf(event.onsetTicks);
    if (sampleIndex < 0n || sampleIndex >= BigInt(signal.sampleCount)) continue;

    const samplesPerRecord = BigInt(signal.samplesPerRecord);
    const recordIndex = Number(sampleIndex / samplesPerRecord);
    const offsetInRecord = Number(sampleIndex % samplesPerRecord);

    const chunk = await readRecords(recording, {
      records: { start: recordIndex, count: 1 },
      signalIndices: [signal.index],
    });
    const [series] = chunk.signals;
    if (series === undefined) continue;
    const microvolts = toPhysical(signal, series.digital);

    printed.push({
      text: event.text,
      sampleIndex,
      microvolts: microvolts[offsetInRecord] ?? Number.NaN,
      firstSampleIndex: series.firstSampleIndex,
    });
  }
  return printed;
}

async function pageRecording(): Promise<{ recording: EdfRecording; signal: EdfSignal }> {
  const recording = await openEdf(byteSource(PAGE_FILE));
  return { recording, signal: getSignal(recording.header, 'EEG Fpz-Cz') };
}

describe('the output the page prints', () => {
  /** `// Sleep stage W 256n 0.007629510948348211` -> the three fields, read off the page. */
  const EXPECTED = [...PAGE.matchAll(/^\/\/ (Sleep stage \S+) (\d+)n (\S+)$/gm)].map((match) => ({
    text: match[1] ?? '',
    sampleIndex: BigInt(match[2] ?? '0'),
    microvolts: Number(match[3]),
  }));

  it('found both lines on the page, so a passing run is not a vacuous one', () => {
    expect(EXPECTED).toHaveLength(2);
    expect(EXPECTED.map((line) => line.text)).toEqual(['Sleep stage W', 'Sleep stage 1']);
  });

  it('is what the program produces, field for field', async () => {
    const { recording, signal } = await pageRecording();
    const printed = await runWorkedExample(recording, signal);
    expect(
      printed.map(({ text, sampleIndex, microvolts }) => ({ text, sampleIndex, microvolts })),
    ).toEqual(EXPECTED);
  });

  it('is the file the top of the page describes, so one fixture serves both ends of it', async () => {
    const { recording } = await pageRecording();
    const { header } = recording;
    const region = header.signals[header.annotationSignalIndices[0] ?? -1];
    expect(region?.samplesPerRecord).toBe(60);
    expect(region?.recordByteLength).toBe(120);
    // 256 + 128 data samples at two bytes each is where the page's 768 comes from.
    expect(region?.recordByteOffset).toBe(768);
  });

  it('prints the same float twice because both events land on a record boundary', async () => {
    const { signal } = await pageRecording();
    const scale = signal.scale;
    expect(scale).toBeDefined();
    // The physical value of digital zero, which is the first sample of every record here.
    expect(EXPECTED[0]?.microvolts).toBe((scale?.bitValue ?? 0) * (scale?.offset ?? 0));
    expect(EXPECTED[1]?.microvolts).toBe(EXPECTED[0]?.microvolts);
  });
});

describe('the four lines the page tells you to write', () => {
  it('are the ones edfcore uses, so a reader who copies them gets the same arithmetic', () => {
    const source = readFileSync(new URL('../../src/tal/ticks.ts', import.meta.url), 'utf8');
    const inSource =
      /export function floorDiv\(a: bigint, b: bigint\): bigint \{\n([\s\S]*?)\n\}/.exec(source);
    const onPage = /^function floorDiv\(a: bigint, b: bigint\): bigint \{\n([\s\S]*?)\n\}$/m.exec(
      PAGE,
    );
    expect(inSource?.[1]).toBeDefined();
    expect(onPage?.[1]).toBeDefined();
    expect(onPage?.[1]).toBe(inSource?.[1]);
  });
});

describe('step 4: "the check that the two agree"', () => {
  it('holds — firstSampleIndex comes back as recordIndex x samplesPerRecord', async () => {
    const { recording, signal } = await pageRecording();
    const printed = await runWorkedExample(recording, signal);
    expect(printed).toHaveLength(2);
    for (const line of printed) {
      const recordIndex = Number(line.sampleIndex / BigInt(signal.samplesPerRecord));
      expect(line.firstSampleIndex).toBe(recordIndex * signal.samplesPerRecord);
    }
  });
});

describe('step 3: an event outside the samples', () => {
  it('is skipped rather than read, which is what the negative bound is for', async () => {
    const { recording, signal } = await pageRecording();
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const preStimulus = annotations.find((event) => event.text === 'pre-stimulus baseline');
    expect(preStimulus).toBeDefined();
    const elapsed = (preStimulus?.onsetTicks ?? 0n) - recording.timeline.startOffsetTicks;
    const index = floorDiv(
      elapsed * BigInt(signal.samplesPerRecord),
      recording.header.recordDurationTicks,
    );
    expect(index).toBeLessThan(0n);
  });
});

describe('"the floor matters for negative onsets"', () => {
  /**
   * The page's claim is directional: truncation "rounds a pre-stimulus event UP, toward the file
   * start, by one sample". The page's own `-0.75` is an exact multiple of the sample interval at
   * 256 samples a second, so both roundings agree on it — this fixture moves it off the grid,
   * which is where the sentence has content.
   */
  const OFF_GRID = buildEdf({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 256 }],
    annotationSignals: [
      {
        samplesPerRecord: 60,
        tals: (record) => (record === 0 ? [{ onset: '-0.7501', texts: ['Sleep stage pre'] }] : []),
      },
    ],
  });

  it('lands one sample earlier than bigint division would', async () => {
    const recording = await openEdf(byteSource(OFF_GRID));
    const signal = getSignal(recording.header, 'EEG Fpz-Cz');
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const event = annotations[0];
    expect(event?.text).toBe('Sleep stage pre');

    const elapsed = (event?.onsetTicks ?? 0n) - recording.timeline.startOffsetTicks;
    const numerator = elapsed * BigInt(signal.samplesPerRecord);
    const duration = recording.header.recordDurationTicks;

    expect(numerator % duration).not.toBe(0n);
    expect(floorDiv(numerator, duration)).toBe(-193n);
    // What the operator gives: one sample later, i.e. toward the file start.
    expect(numerator / duration).toBe(-192n);
    expect(numerator / duration).toBe(floorDiv(numerator, duration) + 1n);
  });
});

describe('the Warning under the program', () => {
  /** Two records, then a five-second hole, then two more: an honest EDF+D. */
  const GAPPED = buildEdf({
    plus: 'D',
    recordCount: 4,
    recordDurationSeconds: 1,
    recordOnsetSeconds: (record) => (record < 2 ? record : record + 5),
    signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 256 }],
    annotationSignals: [{ samplesPerRecord: 60 }],
  });

  it('is true: the formula gives a time-axis position the sample grid does not have', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const signal = getSignal(recording.header, 'EEG Fpz-Cz');
    const duration = recording.header.recordDurationTicks;

    // t = 2.5 s is inside the hole: record 1 ends at 2 s and record 2 begins at 7 s. The formula
    // answers anyway, because it knows nothing about gaps — and its answer is a perfectly ordinary
    // index, well inside the samples the file holds, which is what makes it dangerous.
    const insideTheGap = (5n * duration) / 2n;
    const formulaSays = floorDiv(insideTheGap * BigInt(signal.samplesPerRecord), duration);
    expect(formulaSays).toBe(640n);
    expect(formulaSays).toBeLessThan(BigInt(signal.sampleCount));

    // What the page says to use instead. There is no record covering that instant at all.
    const index = await buildRecordIndex(recording);
    expect(index.coverage).toBe('complete');
    expect(await index.locate(2.5)).toBeUndefined();
  });

  it('and misplaces an instant that IS in the file, past the gap', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const duration = recording.header.recordDurationTicks;

    // Record 2 really starts at t = 7 s. The formula puts t = 7 s at record 7, which the file
    // does not have; the scanned index puts it at record 2, where the samples actually are.
    const formulaRecord = Number(floorDiv(7n * duration, duration));
    expect(formulaRecord).toBe(7);
    expect(formulaRecord).toBeGreaterThanOrEqual(recording.header.recordCount);

    const index = await buildRecordIndex(recording);
    const located = await index.locate(7);
    expect(located?.recordIndex).toBe(2);
  });
});

describe('"each signal has its own grid"', () => {
  it('gives the 128-sample channel its own index for the same instant', async () => {
    const recording = await openEdf(byteSource(PAGE_FILE));
    const duration = recording.header.recordDurationTicks;
    const fast = getSignal(recording.header, 'EEG Fpz-Cz');
    const slow = getSignal(recording.header, 'EEG Pz-Oz');

    const at = (signal: EdfSignal): bigint =>
      floorDiv(1n * duration * BigInt(signal.samplesPerRecord), duration);

    expect(at(fast)).toBe(256n);
    expect(at(slow)).toBe(128n);
    // The same instant, two indices — which is why the page says not to reuse one for the other.
    expect(at(fast)).not.toBe(at(slow));
  });
});
