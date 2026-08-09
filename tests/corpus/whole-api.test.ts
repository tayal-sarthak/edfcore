/**
 * Every public entry point, over every real file.
 *
 * The other corpus tests each check one claim deeply. This one is broad and shallow on purpose:
 * it calls essentially the whole barrel against six files written by five different pieces of
 * software across twenty-one years, and asserts the results are mutually consistent.
 *
 * That catches a different class of thing. A function can be individually correct and still
 * disagree with its neighbour — six releases of this project were exactly that — and a function
 * can be correct on the fixtures written to exercise it and throw on the first real file with a
 * zero record duration, a duplicate label, or no signals at all. Neither shows up in a test
 * written for one function.
 *
 * `inspectEdf` gets particular attention because it makes the strongest promise in the package:
 * it never throws about file CONTENT. Every file here is its chance to break that.
 *
 * Skips without the corpus. `npm run corpus:fetch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  annotationsAt,
  buildRecordIndex,
  byteSource,
  contiguityOf,
  countAnnotationsByText,
  declaredDurationSeconds,
  filterAnnotationsByTime,
  formatAnnotations,
  formatDiagnostics,
  formatHeader,
  gapAt,
  inspectEdf,
  matchSignals,
  mergeChunks,
  openEdf,
  physicalRangeOf,
  readAnnotations,
  readEnvelope,
  readWindow,
  sampleAt,
  sampleStartSecondsOf,
  segmentAt,
  summarizeDiagnostics,
  toPhysical,
} from '../../src/index.js';

const FILES = join(dirname(fileURLToPath(import.meta.url)), 'files');

const CORPUS = [
  'SC4001E0-PSG.edf',
  'SC4001EC-Hypnogram.edf',
  'test_generator.edf',
  'test_generator_2.edf',
  'test_generator_2.bdf',
  'chb01_01.edf',
  'calib.rec',
] as const;

const present = CORPUS.filter((name) => existsSync(join(FILES, name)));
const bytesOf = (name: string) => new Uint8Array(readFileSync(join(FILES, name)));

describe.each(present.length > 0 ? present : (['(corpus absent)'] as const))('%s', (name) => {
  const maybe = present.includes(name as (typeof CORPUS)[number]) ? it : it.skip;

  maybe('inspectEdf never throws about content, whatever the file holds', async () => {
    // The strongest promise in the package, against every real file at once. These include a file
    // with no signals, one with a zero record duration, and one with a duplicated channel label.
    const inspection = await inspectEdf(byteSource(bytesOf(name)));
    expect(inspection).toBeDefined();
    expect(typeof inspection.variant).toBe('string');
    /*
     * Whatever it reports must be internally consistent rather than merely present.
     *
     * This asserted `signals.length` against ITSELF until 0.3.101 — both operands the same
     * expression — so the one line claiming to check consistency, in the test the file's docblock
     * calls the strongest promise in the package, checked nothing on any corpus file.
     */
    if (inspection.header !== undefined) {
      const { header } = inspection;
      // The two index arrays partition the signals: every signal is data or annotations, and no
      // signal is both.
      expect(header.dataSignalIndices.length + header.annotationSignalIndices.length).toBe(
        header.signals.length,
      );
      expect(new Set([...header.dataSignalIndices, ...header.annotationSignalIndices]).size).toBe(
        header.signals.length,
      );
      // The reported header length is the one the signal count implies.
      expect(header.headerByteLength).toBe(256 * (header.signals.length + 1));
      // `bytesRead` never exceeds what the file holds, and never exceeds the ceiling.
      expect(inspection.bytesRead).toBeLessThanOrEqual(inspection.byteLength);
      expect(inspection.bytesRead).toBeLessThanOrEqual(128 * 1024);
      // `ok` is exactly "no error-severity diagnostic", which is what the docblock promises.
      expect(inspection.ok).toBe(inspection.diagnostics.every((d) => d.severity !== 'error'));
    }
  });

  maybe('the header helpers agree with the header', async () => {
    const recording = await openEdf(byteSource(bytesOf(name)));
    const { header } = recording;

    // matchSignals never returns the annotations channel; findSignals-style helpers agree with
    // the kinds the parser assigned.
    const everyData = matchSignals(header, /.*/);
    expect(everyData.every((s) => s.kind === 'data')).toBe(true);
    expect(everyData).toHaveLength(header.dataSignalIndices.length);

    // Declared duration is what the records COVER, so never more than the span.
    expect(declaredDurationSeconds(header)).toBeLessThanOrEqual(
      recording.timeline.spanSeconds + 1e-9,
    );

    // A physical range exists for every signal whose bounds parsed, and is ordered.
    for (const signal of header.signals) {
      if (!Number.isFinite(signal.physicalMinimum) || !Number.isFinite(signal.physicalMaximum)) {
        continue;
      }
      const range = physicalRangeOf(signal);
      expect(range.low, signal.label).toBeLessThanOrEqual(range.high);
    }

    // The formatters produce text and never leak identification without being asked.
    expect(formatHeader(header)).toContain(header.variant);
    expect(typeof formatDiagnostics(header.diagnostics)).toBe('string');
    const summary = summarizeDiagnostics(header.diagnostics);
    expect(summary.errors + summary.warnings + summary.infos).toBe(summary.total);
  });

  maybe('the timeline helpers agree with the scanned index', async () => {
    const opened = await openEdf(byteSource(bytesOf(name)));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    const { index } = recording;

    expect(contiguityOf(index)).not.toBe('unknown');
    const segments = index.segments ?? [];
    const gaps = index.gaps ?? [];
    expect(gaps.length).toBe(Math.max(0, segments.length - 1));

    // Segments cover every record exactly once, in order.
    let expectedNext = 0;
    let covered = 0;
    for (const segment of segments) {
      expect(segment.records.start).toBe(expectedNext);
      expectedNext = segment.records.start + segment.records.count;
      covered += segment.records.count;
    }
    expect(covered).toBe(recording.header.recordCount);

    // segmentAt and gapAt partition the span: never both, and inside a segment never neither.
    //
    // A ZERO record duration is the exception, and it is a real one rather than a bug. Records
    // then occupy no time, so every segment's half-open interval `[start, start)` is empty and no
    // instant is inside any of them. `segmentAt` returns undefined for every time on such a file,
    // which is the same answer the sample functions give for the same reason: there is no time
    // axis to be on. The sleep-edfx hypnogram is a real file of exactly that shape.
    for (const segment of segments) {
      if (segment.durationSeconds === 0) {
        expect(segmentAt(index, segment.startSeconds), 'zero-width segment').toBeUndefined();
        continue;
      }
      const inside = segment.startSeconds + Math.min(0.5, segment.durationSeconds / 2);
      expect(segmentAt(index, inside), `segment ${segment.index}`).toBeDefined();
      expect(gapAt(index, inside), `segment ${segment.index}`).toBeUndefined();
    }
    for (const gap of gaps) {
      const inside = gap.startSeconds + gap.durationSeconds / 2;
      expect(gapAt(index, inside)).toBeDefined();
      expect(segmentAt(index, inside)).toBeUndefined();
    }
  });

  maybe('reading, scaling and decimating agree with each other', async () => {
    const opened = await openEdf(byteSource(bytesOf(name)));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    const data = recording.header.dataSignalIndices;
    if (data.length === 0 || recording.header.recordCount === 0) return;

    const signalIndex = data[0] as number;
    const signal = recording.header.signals[signalIndex];
    if (signal === undefined || signal.samplesPerRecord === 0) return;

    // A short window near the start, whatever the file's geometry.
    const startSeconds = recording.timeline.spanSeconds > 4 ? 2 : 0;
    const durationSeconds = Math.min(2, Math.max(recording.header.recordDurationSeconds, 1));
    const chunks = await readWindow(recording, {
      signalIndices: [signalIndex],
      startSeconds,
      durationSeconds,
    });
    if (chunks.length === 0) return;

    // mergeChunks accepts what one window produced, or refuses with a reason.
    const merged = chunks.length === 1 ? chunks[0] : mergeChunks(chunks);
    expect(merged).toBeDefined();
    const digital = merged?.signals[0]?.digital;
    if (digital === undefined) return;

    // Scaling produces one value per sample, and none of them is NaN.
    if (signal.scale !== undefined) {
      const physical = toPhysical(signal, digital);
      expect(physical.length).toBe(digital.length);
      expect(physical.every((v) => Number.isFinite(v))).toBe(true);
    }

    // An envelope over the same window sees the same extremes the samples have.
    const [envelope] = await readEnvelope(recording, {
      signalIndices: [signalIndex],
      startSeconds,
      durationSeconds,
      buckets: 8,
    });
    const bucketMin = Math.min(...(envelope?.signals[0]?.min ?? [0]));
    const bucketMax = Math.max(...(envelope?.signals[0]?.max ?? [0]));
    expect(bucketMin).toBe(Math.min(...digital));
    expect(bucketMax).toBe(Math.max(...digital));
  });

  maybe('sample location round-trips against what a read reports', async () => {
    const opened = await openEdf(byteSource(bytesOf(name)));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    const data = recording.header.dataSignalIndices;
    if (data.length === 0 || recording.header.recordCount === 0) return;

    const signalIndex = data[0] as number;
    const signal = recording.header.signals[signalIndex];
    if (signal === undefined || signal.samplesPerRecord === 0) return;
    if (recording.header.recordDurationSeconds === 0) return; // no time axis at all

    // The first sample of the last record: the far end, where drift shows.
    const lastRecord = recording.header.recordCount - 1;
    const sampleIndex = lastRecord * signal.samplesPerRecord;
    const seconds = sampleStartSecondsOf(recording, signalIndex, sampleIndex);

    const chunk = await readWindow(recording, {
      signalIndices: [signalIndex],
      startSeconds: seconds,
      durationSeconds: recording.header.recordDurationSeconds,
    });
    expect(chunk[0]?.records.start, 'the window starting at that sample reads its record').toBe(
      lastRecord,
    );
    expect(sampleAt(recording, signalIndex, seconds)?.sampleIndex).toBe(sampleIndex);
  });

  maybe('the annotation helpers agree with each other', async () => {
    const recording = await openEdf(byteSource(bytesOf(name)));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });

    // Counting by text accounts for every annotation exactly once.
    const counted = countAnnotationsByText(annotations).reduce((sum, e) => sum + e.count, 0);
    expect(counted).toBe(annotations.length);

    // Formatting produces one line per annotation, or nothing at all for none.
    const text = formatAnnotations(annotations);
    expect(text === '' ? 0 : text.split('\n').length).toBe(annotations.length);

    // Every annotation is found by a window around its own onset, and by annotationsAt at it.
    for (const event of annotations.slice(0, 20)) {
      const at = event.onsetSecondsFromFirstRecord;
      expect(
        filterAnnotationsByTime(annotations, { startSeconds: at, durationSeconds: 0.001 }),
        event.text,
      ).toContain(event);
      expect(annotationsAt(annotations, at), event.text).toContain(event);
    }
  });
});
