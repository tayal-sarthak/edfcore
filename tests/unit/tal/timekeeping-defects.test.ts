/**
 * Timekeeping-TAL defects, and which of them may be reported once.
 *
 * Most cost nothing: the onset is unambiguous and reaches `recordOnsetTicks` either way, so one
 * report per call is the right volume and a per-record flood would bury it. A timekeeping TAL that
 * carries TEXT is the exception — that text is an annotation the writer merged into the wrong TAL,
 * it is in no field of the result, and each occurrence is a DIFFERENT event that is now gone.
 *
 * Before 0.2.33 both shared one flag, so a file whose first record used the widespread
 * `+t 0x14 0x00` shorthand — most of the real corpus — reported the shorthand and then swallowed
 * every dropped event after it.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../../src/diagnostics/format.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../../src/recording.js';
import { buildEdf } from '../../support/writer.js';

const RECORDS = 6;
const encode = (text: string): number[] => Array.from(text).map((c) => c.charCodeAt(0));

/**
 * A file whose writer merged the event into the timekeeping TAL on records 2 and 4, and used the
 * benign shorthand everywhere else. The regions are written by hand so the bytes are exact.
 */
async function sloppyWriter() {
  const bytes = buildEdf({
    plus: 'C',
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 40, tals: () => [] }],
    recordOnsetSeconds: (r: number) => r,
  });
  const probe = await openEdf(byteSource(bytes));
  const header = probe.header;
  const signal = header.signals[header.annotationSignalIndices[0] as number];
  if (signal === undefined) throw new Error('fixture has no annotations channel');

  for (let r = 0; r < RECORDS; r += 1) {
    const offset = header.headerByteLength + r * header.recordByteLength + signal.recordByteOffset;
    bytes.fill(0, offset, offset + signal.recordByteLength);
    const merged = r === 2 ? 'Arousal' : r === 4 ? 'Sleep stage R' : undefined;
    bytes.set(
      merged === undefined
        ? [...encode(`+${r}`), 0x14, 0x00]
        : [...encode(`+${r}`), 0x14, ...encode(merged), 0x14, 0x00],
      offset,
    );
  }
  return openEdf(byteSource(bytes));
}

describe('a timekeeping TAL that swallowed an annotation', () => {
  it('is reported for every affected record, not once for the whole call', async () => {
    const recording = await sloppyWriter();
    const { annotations, diagnostics } = await readAnnotations(recording, {
      start: 0,
      count: RECORDS,
    });

    // The events really are gone from the result — that part is the format's fault, not a bug.
    expect(annotations).toEqual([]);

    // What must not happen is losing them silently. Both records are named, with their text.
    const affected = diagnostics
      .filter((d) => d.code === 'TIMEKEEPING_TAL_NONCONFORMANT' && d.message.includes('dropped'))
      .map((d) => d.recordIndex);
    expect(affected).toEqual([2, 4]);
    expect(JSON.stringify(diagnostics)).toContain('Arousal');
    expect(JSON.stringify(diagnostics)).toContain('Sleep stage R');
  });

  it('still caps the benign shorthand at one report per call', async () => {
    // Four records use `+t 0x14 0x00`. Reporting each would bury the two that matter.
    const recording = await sloppyWriter();
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const shorthand = diagnostics.filter((d) => d.message.includes('widespread shorthand'));
    expect(shorthand).toHaveLength(1);
    expect(shorthand[0]?.recordIndex).toBe(0);
  });

  it('says plainly which kind is capped and which is not', async () => {
    const recording = await sloppyWriter();
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const benign = diagnostics.find((d) => d.message.includes('widespread shorthand'));
    const destructive = diagnostics.find((d) => d.message.includes('dropped'));

    expect(benign?.message).toContain('nothing was lost');
    expect(benign?.message).toContain('once per decodeAnnotations() call');
    expect(destructive?.message).toContain('EVERY affected record');
    // And it points at where the text still is, since the result no longer holds it.
    expect(destructive?.message).toContain('raw bytes');
  });

  it('does not let a benign first record consume the only slot', async () => {
    // The precise defect: record 0's shorthand fired first and set the shared flag, so records 2
    // and 4 were never reported at all and the one warning named a different, harmless cause.
    const recording = await sloppyWriter();
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: RECORDS });
    expect(diagnostics.filter((d) => d.code === 'TIMEKEEPING_TAL_NONCONFORMANT')).toHaveLength(3);
  });
});

describe('a timekeeping TAL that carries a duration AS WELL AS text', () => {
  /**
   * The combination 0.2.33 left uncovered. That release split the once-per-call flag between the
   * benign and the destructive kinds and left the CHECK ORDER alone, and the fixture above builds
   * a merged TAL with text and no duration — so nothing exercised a TAL that is wrong in both ways
   * at once. `timekeepingDefect` returns at the first match and asked about the duration first, so
   * such a TAL was classified as losing nothing, capped at one report, and described by a message
   * ending "nothing was lost".
   *
   * A writer that merges a scored epoch into the timekeeping TAL writes exactly this:
   * `+onset 0x15 30 0x14 Sleep stage W 0x14 0x14 0x00`.
   */
  async function mergedEpochs(withDuration: boolean) {
    const bytes = buildEdf({
      plus: 'C',
      recordCount: RECORDS,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 40, tals: () => [] }],
      recordOnsetSeconds: (r: number) => r,
    });
    const probe = await openEdf(byteSource(bytes));
    const header = probe.header;
    const signal = header.signals[header.annotationSignalIndices[0] as number];
    if (signal === undefined) throw new Error('fixture has no annotations channel');

    for (let r = 0; r < RECORDS; r += 1) {
      const offset =
        header.headerByteLength + r * header.recordByteLength + signal.recordByteOffset;
      bytes.fill(0, offset, offset + signal.recordByteLength);
      bytes.set(
        [
          ...encode(`+${r}`),
          ...(withDuration ? [0x15, ...encode('30')] : []),
          0x14,
          ...encode('Sleep stage W'),
          0x14,
          0x14,
          0x00,
        ],
        offset,
      );
    }
    return openEdf(byteSource(bytes));
  }

  it('names every record whose epoch was dropped, not one blaming the duration', async () => {
    const recording = await mergedEpochs(true);
    const { annotations, diagnostics } = await readAnnotations(recording, {
      start: 0,
      count: RECORDS,
    });

    // All six epochs are gone from the result — the format's fault, not a bug.
    expect(annotations).toEqual([]);

    const dropped = diagnostics.filter(
      (d) => d.code === 'TIMEKEEPING_TAL_NONCONFORMANT' && d.message.includes('dropped'),
    );
    expect(dropped.map((d) => d.recordIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(dropped[0]?.message).toContain('"Sleep stage W"');
    // The stray duration is still mentioned; it is just no longer the headline.
    expect(dropped[0]?.message).toContain('the duration "30"');
    // And the message that said otherwise is gone.
    expect(JSON.stringify(diagnostics)).not.toContain('nothing was lost');
  });

  it('reports the same six with the duration removed', async () => {
    // Adding a duration to the same TAL used to turn six loud reports into one misleading one.
    const recording = await mergedEpochs(false);
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const dropped = diagnostics.filter((d) => d.message.includes('dropped'));
    expect(dropped.map((d) => d.recordIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('the evidence the diagnostic names is the evidence it carries', () => {
  it('publishes the bytes at [byteOffset, byteOffset + byteLength)', async () => {
    /*
     * `byteOffset`/`byteLength` name the whole TAL, but `raw` held `tal.onsetRaw` alone and no
     * `rawBytes` was set — so `raw` was two characters for a twelve-byte span, contradicting the
     * documented meaning of the field ("those bytes as text, exactly as written including
     * padding"), and `formatDiagnostics` printed no `bytes:` line on the one diagnostic whose
     * Next: step sends the reader to the bytes. `reportIssue` has done this correctly since
     * 0.3.68 (fixed in 0.3.115).
     */
    const recording = await sloppyWriter();
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const dropped = diagnostics.filter(
      (one) => one.code === 'TIMEKEEPING_TAL_NONCONFORMANT' && one.message.includes('dropped'),
    );
    expect(dropped).toHaveLength(2);

    const file = await recording.source.read(0, recording.source.byteLength);
    for (const diagnostic of dropped) {
      const { byteOffset, byteLength } = diagnostic;
      expect(byteOffset).toBeDefined();
      expect(byteLength).toBeDefined();
      if (byteOffset === undefined || byteLength === undefined) throw new Error('no span');

      const named = file.subarray(byteOffset, byteOffset + byteLength);
      // The bytes it carries ARE the bytes it names — not a prefix of them, not the onset alone.
      expect(diagnostic.rawBytes).toBeDefined();
      expect(Array.from(diagnostic.rawBytes ?? [])).toEqual(Array.from(named));
      expect(diagnostic.raw?.length).toBe(byteLength);
    }

    // And the rendered block carries the `bytes:` line the Next: step points at.
    expect(formatDiagnostics(dropped)).toMatch(/\n {2}bytes: /);
  });
});

describe('a timekeeping TAL with more than one empty text', () => {
  /*
   * The fourth rung of `timekeepingDefect`'s ladder, and the one that had never run.
   *
   * `+t 0x14 0x14 0x00` is the conforming shape: one onset, no duration, exactly one empty text.
   * `+t 0x14 0x00` drops the empty text and is the widespread shorthand above. This is the other
   * direction — `+t 0x14 0x14 0x14 0x00`, two empty texts — which a writer emits by looping over
   * an events list that happens to be empty and terminating each iteration anyway.
   *
   * Benign, like the shorthand: the onset is unambiguous, nothing was carried and nothing is lost.
   * What makes it worth reporting at all is that it is the same class of writer bug as the merged
   * annotation, and a reader comparing two files needs to know which one their parser was lenient
   * about. EDFlib rejects both.
   */
  const encodeOnset = (record: number): number[] => encode(`+${record}`);

  /** Every record's timekeeping TAL rewritten to the shape the case names. */
  async function withTimekeeping(shape: (record: number) => number[]) {
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 3,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 40, tals: () => [] }],
      recordOnsetSeconds: (r: number) => r,
    });
    const probe = await openEdf(byteSource(bytes));
    const header = probe.header;
    const signal = header.signals[header.annotationSignalIndices[0] as number];
    if (signal === undefined) throw new Error('fixture has no annotations channel');
    for (let r = 0; r < 3; r += 1) {
      const offset =
        header.headerByteLength + r * header.recordByteLength + signal.recordByteOffset;
      bytes.fill(0, offset, offset + signal.recordByteLength);
      bytes.set(shape(r), offset);
    }
    return openEdf(byteSource(bytes));
  }

  const TWO_EMPTY = (r: number): number[] => [...encodeOnset(r), 0x14, 0x14, 0x14, 0x00];
  const CONFORMING = (r: number): number[] => [...encodeOnset(r), 0x14, 0x14, 0x00];

  it('is reported, and says how many it found', async () => {
    const recording = await withTimekeeping(TWO_EMPTY);
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: 3 });

    const reported = diagnostics.filter((d) => d.code === 'TIMEKEEPING_TAL_NONCONFORMANT');
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain('carries 2 empty texts, where the grammar allows');
  });

  it('is counted as benign, so it is capped at one report per call', async () => {
    // All three records are malformed the same way. The cap is the whole reason the two kinds
    // carry separate flags, and a rung landing on the destructive side would flood a real file.
    const recording = await withTimekeeping(TWO_EMPTY);
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: 3 });
    const reported = diagnostics.find((d) => d.code === 'TIMEKEEPING_TAL_NONCONFORMANT');

    expect(reported?.message).toContain('nothing was lost');
    expect(reported?.message).toContain('once per decodeAnnotations() call');
    expect(reported?.message).not.toContain('EVERY affected record');
  });

  it('still uses the onset, which is what makes it benign', async () => {
    const recording = await withTimekeeping(TWO_EMPTY);
    const { annotations } = await readAnnotations(recording, { start: 0, count: 3 });
    // No events, because nothing was carried — the malformation is in the empty runs alone.
    expect(annotations).toEqual([]);
    // And the record onsets are the ones the TALs state, so the timing survived the defect.
    expect(recording.timeline.spanSeconds).toBe(3);
  });

  it('says nothing about the conforming shape, which differs by one byte', async () => {
    // Non-vacuity, and precisely scoped: the same fixture, the same hand-written regions, one
    // 0x14 fewer. A check that fired on both would pass every assertion above.
    const recording = await withTimekeeping(CONFORMING);
    const { diagnostics } = await readAnnotations(recording, { start: 0, count: 3 });
    expect(diagnostics.map((d) => d.code)).not.toContain('TIMEKEEPING_TAL_NONCONFORMANT');
  });
});
