/**
 * Three ways a header can be written and mean the same thing.
 *
 * EDF is a text format in fixed-width fields, and three of its conventions let two byte sequences
 * describe one recording. Each is documented, each is reached by real writers, and each was tested
 * for the thing it produces rather than for the equivalence it implies.
 *
 * **A record count of `-1`.** `types.ts` says of the field: "Verbatim. `-1` means the writer never
 * closed the file." `parseHeader` recovers the count from the source's length and says so with
 * `RECORD_COUNT_RECOVERED` and `recordCountSource: 'sourceByteLength'`. `parse.test.ts` checks the
 * recovery; nothing checked that the recovered file is the same recording as the one that declares
 * its count — which is the only reason recovering is better than refusing.
 *
 * **Either family's annotation label.** `annotations.md`: "edfcore accepts either label in either
 * family, because the label names the channel's *role*." `isAnnotationLabel` is tested on the
 * strings. Whether a BDF+ file whose channel says `EDF Annotations` reads its events was not.
 *
 * **NUL padding.** EDF pads with spaces; real writers pad with NUL, which is why `trimEdfField`
 * exists and why five docblocks in `src/` warn that `String.prototype.trim` does not strip it. The
 * function is tested. That the two paddings produce the same header, with no extra diagnostic
 * between them, was not.
 *
 * Each is asserted as an equivalence — every sample, every event, every derived number — and each
 * with the one thing that legitimately differs named beside it.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { setHeaderField, setSignalField } from '../support/corrupt.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const ANNOTATIONS_PAGE = (DOCS_PAGES.get('annotations.md') ?? '').replace(/\s+/g, ' ');
const NUL = String.fromCharCode(0);
const RECORDS = 6;
const SIGNAL_COUNT = 2;

const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint'
      ? `${member}n`
      : ArrayBuffer.isView(member)
        ? [...(member as unknown as Int32Array)]
        : member,
  );

function fileFor(format: 'EDF' | 'BDF'): Uint8Array {
  return buildEdf({
    format,
    plus: 'C',
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 8, sample: (record, index) => record * 8 + index }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: (record) => (record === 2 ? [{ onset: '+2.5', duration: 1, texts: ['spike'] }] : []),
      },
    ],
  });
}

/** Everything the API says about a file, so an equivalence is asserted rather than sampled. */
async function everything(recording: EdfRecording): Promise<string> {
  const chunk = await readRecords(recording, {
    records: { start: 0, count: recording.header.recordCount },
    signalIndices: [0],
  });
  const annotations = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  return shape({
    variant: recording.header.variant,
    recordCount: recording.header.recordCount,
    recordByteLength: recording.header.recordByteLength,
    // Without `raw`, which is the bytes as written and is exactly what these spellings differ in.
    signals: recording.header.signals.map(({ raw: _raw, ...rest }) => rest),
    span: recording.timeline.spanSeconds,
    covered: recording.timeline.coveredSeconds,
    chunk,
    annotations: annotations.annotations,
    onsets: [...annotations.recordOnsetTicks],
  });
}

const EDF = fileFor('EDF');
const BDF = fileFor('BDF');

describe('a record count of -1', () => {
  const UNCLOSED = setHeaderField(EDF, 'recordCount', '-1      ');

  it('is recovered from the length, and says which it did', async () => {
    const recording = await openEdf(byteSource(UNCLOSED));
    expect(recording.header.recordCount).toBe(RECORDS);
    expect(recording.header.recordCountSource).toBe('sourceByteLength');
    expect(recording.header.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'RECORD_COUNT_RECOVERED',
    );
    // The file that declares its count says the other thing.
    const declared = await openEdf(byteSource(EDF));
    expect(declared.header.recordCountSource).not.toBe('sourceByteLength');
    expect(declared.header.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'RECORD_COUNT_RECOVERED',
    );
  });

  it('and is otherwise the same recording, which is why recovering beats refusing', async () => {
    const recovered = await openEdf(byteSource(UNCLOSED));
    const declared = await openEdf(byteSource(EDF));
    expect(await everything(recovered)).toBe(await everything(declared));
    // The comparison is a real one: the file has samples and an event in it.
    expect((await everything(declared)).length).toBeGreaterThan(1_000);
  });
});

describe('either family’s annotation label', () => {
  it('is the claim the page makes', () => {
    expect(ANNOTATIONS_PAGE).toContain('edfcore accepts either label in either family');
    expect(ANNOTATIONS_PAGE).toContain('the label names the channel');
  });

  it.each([
    ['EDF', 'BDF Annotations '],
    ['BDF', 'EDF Annotations '],
  ] as const)('reads a %s file whose channel says "%s"', async (format, label) => {
    const original = format === 'EDF' ? EDF : BDF;
    const swapped = setSignalField(original, SIGNAL_COUNT, 1, 'label', label);

    const asWritten = await openEdf(byteSource(original));
    const withOtherLabel = await openEdf(byteSource(swapped));

    expect(withOtherLabel.header.annotationSignalIndices).toEqual([1]);
    expect(withOtherLabel.header.signals[1]?.kind).toBe('annotations');
    expect(withOtherLabel.header.dataSignalIndices).toEqual(asWritten.header.dataSignalIndices);

    const before = await readAnnotations(asWritten, { start: 0, count: RECORDS });
    const after = await readAnnotations(withOtherLabel, { start: 0, count: RECORDS });
    expect(shape(after.annotations)).toBe(shape(before.annotations));
    expect([...after.recordOnsetTicks]).toEqual([...before.recordOnsetTicks]);
    expect(after.annotations).toHaveLength(1);

    // The label itself is the one thing that differs, and it is reported verbatim.
    expect(withOtherLabel.header.signals[1]?.label).toBe(label.trim());
    expect(withOtherLabel.header.signals[1]?.label).not.toBe(asWritten.header.signals[1]?.label);
  });
});

describe('NUL padding where the spec says space', () => {
  const SPACES = setSignalField(EDF, SIGNAL_COUNT, 0, 'label', `Fp1${' '.repeat(13)}`);
  const NULS = setSignalField(EDF, SIGNAL_COUNT, 0, 'label', `Fp1${NUL.repeat(13)}`);

  it('gives the same trimmed label, which .trim() would not', async () => {
    const spaced = await openEdf(byteSource(SPACES));
    const nulled = await openEdf(byteSource(NULS));
    expect(nulled.header.signals[0]?.label).toBe('Fp1');
    expect(spaced.header.signals[0]?.label).toBe('Fp1');

    // The raw bytes really do differ, so this is not the same file twice.
    expect(nulled.header.signals[0]?.raw.label).not.toBe(spaced.header.signals[0]?.raw.label);
    expect(nulled.header.signals[0]?.raw.label).toContain(NUL);
    // And `String.prototype.trim` is the thing that would have got it wrong.
    expect((nulled.header.signals[0]?.raw.label ?? '').trim()).not.toBe('Fp1');
  });

  it('and the same recording, with no diagnostic between them', async () => {
    const spaced = await openEdf(byteSource(SPACES));
    const nulled = await openEdf(byteSource(NULS));
    expect(nulled.header.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      spaced.header.diagnostics.map((diagnostic) => diagnostic.code),
    );
    expect(await everything(nulled)).toBe(await everything(spaced));
  });
});
