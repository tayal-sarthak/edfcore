/**
 * Reading a secondary annotations signal, and the record onsets that quietly stop being true.
 *
 * EDF+ permits several annotation signals and reserves timekeeping to the FIRST one.
 * `annotations.md` documents both, and then documents the consequence in a sentence that reads
 * like a footnote: "Leaving out the file's first annotations signal means no timekeeping TAL is
 * read at all. Every entry of `result.recordOnsetTicks` then falls back to the nominal grid, and
 * no diagnostic is emitted for it."
 *
 * On an EDF+D file that is the difference between the truth and a fiction. `recordOnsetTicks` is
 * described on the same page as "the primitive every timeline in edfcore is built from", and
 * `{ signalIndices: [2] }` — a narrowing a caller reaches for to make a read cheaper, or because
 * the events they want are on the second channel — turns it into `recordIndex * recordDuration`
 * for a file whose records are nowhere near that. Nothing throws, nothing is logged, and the
 * array has the right length and the right type. The only signal that anything happened is that
 * the numbers are wrong.
 *
 * The fixture below has a five-second hole after record 1, so the true onsets are 0, 1, 7, 8 s and
 * the nominal grid is 0, 1, 2, 3 s. Every record is wrong by five seconds from the third on, and
 * `diagnostics` is empty in both readings.
 *
 * The two refusals a caller reaches by passing the wrong index are checked with it, because they
 * are the other two outcomes of the same option: a plain `RangeError` for a data signal, since
 * parsing samples as text is a caller's mistake and never a file's, and `EdfChannelNotFoundError`
 * carrying `selector` and `availableLabels` for an index the file does not have. The page prints
 * the first of those verbatim, and it is compared against the page's own words.
 *
 * `concepts-annotations.test.ts` already covers that both signals are read and that the second
 * one's first TAL survives as a real event. Neither of those is repeated here; what it does not
 * cover, and what the whole option turns on, is what happens to the onsets.
 *
 * What this does NOT check: the TAL grammar, the timekeeping rule itself, or the derivation used
 * when a timekeeping TAL is missing. Those are `tal/timekeeping-defects.test.ts` and
 * `tal/derived-start-offset.test.ts`. This is about which SIGNALS a read was pointed at.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('annotations.md') ?? '';

const RECORDS = { start: 0, count: 4 } as const;
const SECOND = 10_000_000n;

/**
 * Two annotation signals on a file with a five-second hole after record 1. Signal 2's first TAL
 * sits in slot 0 — the position reserved for timekeeping on signal 1 — and carries a real text, so
 * the "it stays in the list" claim is about the slot rather than about the content.
 */
const TWO_SIGNALS = buildEdf({
  plus: 'D',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 5),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 24,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', texts: ['on the first signal'] }] : []),
    },
    {
      samplesPerRecord: 24,
      tals: (record) => (record === 0 ? [{ onset: '+0', texts: ['in slot 0 of the second'] }] : []),
    },
  ],
});

/** One annotation signal, which is the file the page's two error transcripts are written against. */
const ONE_SIGNAL = minimalEdfPlus({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 20 }],
});

const onsetsOf = (ticks: BigInt64Array): readonly bigint[] => [...ticks];

describe('a file with two annotation signals', () => {
  it('lists both, which is the value the page prints', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    expect(recording.header.annotationSignalIndices).toEqual([1, 2]);
    // `recording.header.annotationSignalIndices;  // [1, 2]`
    expect(PAGE).toContain('annotationSignalIndices;  // [1, 2]');
  });

  it('gives the fixture one event on each, so the reads below can be told apart', async () => {
    // `concepts-annotations.test.ts` owns the claim that both are read and that the second
    // signal's first TAL survives. This is only the setup the onset assertions below rely on.
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const { annotations } = await readAnnotations(recording, RECORDS);
    expect(annotations.map((event) => event.signalIndex)).toEqual([2, 1]);
    expect(annotations.map((event) => event.text)).toEqual([
      'in slot 0 of the second',
      'on the first signal',
    ]);
  });
});

describe('the true record onsets', () => {
  /** 0, 1, 7, 8 seconds: the file's own timekeeping, with the five-second hole in it. */
  const TRUE_ONSETS = [0n, SECOND, 7n * SECOND, 8n * SECOND];
  /** 0, 1, 2, 3 seconds: `recordIndex * recordDuration`, which this file's records do not follow. */
  const NOMINAL_GRID = [0n, SECOND, 2n * SECOND, 3n * SECOND];

  it('come back from a default read', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const result = await readAnnotations(recording, RECORDS);
    expect(onsetsOf(result.recordOnsetTicks)).toEqual(TRUE_ONSETS);
  });

  it('come back from a read restricted to the FIRST annotation signal', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const result = await readAnnotations(recording, RECORDS, { signalIndices: [1] });
    expect(onsetsOf(result.recordOnsetTicks)).toEqual(TRUE_ONSETS);
  });

  it('and are replaced by the nominal grid when only the second is read', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const result = await readAnnotations(recording, RECORDS, { signalIndices: [2] });
    expect(onsetsOf(result.recordOnsetTicks)).toEqual(NOMINAL_GRID);
    // The two really do differ, so this is not two names for the same array.
    expect(NOMINAL_GRID).not.toEqual(TRUE_ONSETS);
  });

  it('with no diagnostic to say so, which is the part worth knowing', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const narrowed = await readAnnotations(recording, RECORDS, { signalIndices: [2] });
    expect(narrowed.diagnostics).toEqual([]);
    // Not because this file is quiet in general: the full read is silent too, and correct.
    const full = await readAnnotations(recording, RECORDS);
    expect(full.diagnostics).toEqual([]);
    // Same length, same type, right-looking array. Only the values are wrong.
    expect(narrowed.recordOnsetTicks).toHaveLength(full.recordOnsetTicks.length);
    expect(narrowed.recordOnsetTicks).toBeInstanceOf(BigInt64Array);
  });

  it('and the events of the second signal are unaffected, which is why it is easy to miss', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const narrowed = await readAnnotations(recording, RECORDS, { signalIndices: [2] });
    const full = await readAnnotations(recording, RECORDS);
    const onlySecond = full.annotations.filter((event) => event.signalIndex === 2);
    expect(narrowed.annotations).toEqual(onlySecond);
  });

  it('are recovered by the remedy the page gives: read them all', async () => {
    const recording = await openEdf(byteSource(TWO_SIGNALS));
    const both = await readAnnotations(recording, RECORDS, { signalIndices: [1, 2] });
    expect(onsetsOf(both.recordOnsetTicks)).toEqual(TRUE_ONSETS);
    expect(both.annotations).toHaveLength(2);
  });
});

describe('pointing a read at a signal that cannot hold annotations', () => {
  it('is a plain RangeError, in the words the page transcribes', async () => {
    const recording = await openEdf(byteSource(ONE_SIGNAL));
    const thrown = await readAnnotations(recording, { start: 0, count: 2 }, { signalIndices: [0] })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(RangeError);
    // A caller's mistake, not a file's — parsing samples as text is not something a file did.
    expect(isEdfError(thrown)).toBe(false);

    // The page prints the message across two comment lines. Take the block, then drop the comment
    // markers the wrap introduced — the wrap is not the claim, and the words either side of it are.
    const block = /\/\/ (RangeError: signal 0 is not[\s\S]*?read them all\.)/.exec(PAGE)?.[1] ?? '';
    const transcript = block.replace(/\n\/\/ /g, ' ').replace(/\s+/g, ' ');
    expect(transcript).toMatch(/^RangeError: signal 0 .* read them all\.$/);
    expect(`RangeError: ${(thrown as Error).message}`.replace(/\s+/g, ' ')).toBe(transcript);
  });

  it('is EdfChannelNotFoundError for an index the file does not have, carrying both fields', async () => {
    const recording = await openEdf(byteSource(ONE_SIGNAL));
    const thrown = await readAnnotations(recording, { start: 0, count: 2 }, { signalIndices: [9] })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
    const error = thrown as EdfChannelNotFoundError;
    expect(error.selector).toBe(9);
    expect(error.availableLabels).toEqual(['Fp1', 'EDF Annotations']);
  });

  it('tells the two mistakes apart, which is the distinction the page draws', async () => {
    const recording = await openEdf(byteSource(ONE_SIGNAL));
    const wrongKind = await readAnnotations(
      recording,
      { start: 0, count: 2 },
      { signalIndices: [0] },
    )
      .then(() => undefined)
      .catch((error: unknown) => error);
    const noSuchSignal = await readAnnotations(
      recording,
      { start: 0, count: 2 },
      { signalIndices: [9] },
    )
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(isEdfError(wrongKind)).toBe(false);
    expect(isEdfError(noSuchSignal)).toBe(true);
  });
});
