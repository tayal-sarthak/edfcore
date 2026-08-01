/**
 * Finding a signal by name.
 *
 * DESIGN section 2: "Deleting lookup does not delete `.find()`, which silently returns the first
 * of a duplicate pair. CHB-MIT ships `T8-P8` twice." So the contract under test is not "look up a
 * channel" but "make an ambiguous lookup impossible to get wrong": `findSignals` returns ALL
 * matches, and `getSignal` refuses to choose between them.
 *
 * Matching is exact on the TRIMMED label and is case-sensitive — EDF labels are electrode names,
 * and edfcore has no montage vocabulary with which to decide that 'Fp1' and 'FP1' are the same
 * thing.
 */

import { describe, expect, it } from 'vitest';
import { EdfAmbiguousChannelError, EdfChannelNotFoundError } from '../../../src/errors.js';
import { findSignals, getSignal, isAnnotationLabel } from '../../../src/header/lookup.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfHeader } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const NUL = String.fromCharCode(0);

function parse(bytes: Uint8Array): EdfHeader {
  return parseHeader(bytes, bytes.length);
}

function ambiguousFrom(run: () => unknown): EdfAmbiguousChannelError {
  try {
    run();
  } catch (error) {
    if (error instanceof EdfAmbiguousChannelError) return error;
    throw error;
  }
  throw new Error('expected an EdfAmbiguousChannelError, but the call returned normally');
}

function notFoundFrom(run: () => unknown): EdfChannelNotFoundError {
  try {
    run();
  } catch (error) {
    if (error instanceof EdfChannelNotFoundError) return error;
    throw error;
  }
  throw new Error('expected an EdfChannelNotFoundError, but the call returned normally');
}

/** What CHB-MIT actually ships: 'T8-P8' appears twice, at two different indices. */
const CHB_MIT_LIKE = parse(
  buildEdf({
    signals: [
      { label: 'FP1-F7', samplesPerRecord: 8 },
      { label: 'T8-P8', samplesPerRecord: 8 },
      { label: 'P7-O1', samplesPerRecord: 8 },
      { label: 'T8-P8', samplesPerRecord: 8 },
    ],
    recordCount: 1,
    raw: { startDate: '1.1.2020' },
  }),
);

const ALL_LABELS = ['FP1-F7', 'T8-P8', 'P7-O1', 'T8-P8'];

describe('findSignals', () => {
  it('returns every signal carrying the label, in signal order', () => {
    const matches = findSignals(CHB_MIT_LIKE, 'T8-P8');

    expect(matches.map((signal) => signal.index)).toEqual([1, 3]);
    expect(matches.map((signal) => signal.label)).toEqual(['T8-P8', 'T8-P8']);
  });

  it('returns exactly one match for a unique label', () => {
    const matches = findSignals(CHB_MIT_LIKE, 'P7-O1');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.index).toBe(2);
  });

  it('returns an empty array for a label the file does not carry', () => {
    expect(findSignals(CHB_MIT_LIKE, 'Cz')).toEqual([]);
  });

  it('trims the requested label before matching', () => {
    // EDF pads every field, so the label a caller copies out of a hexdump carries padding.
    expect(findSignals(CHB_MIT_LIKE, '  P7-O1  ').map((signal) => signal.index)).toEqual([2]);
    expect(findSignals(CHB_MIT_LIKE, `P7-O1${NUL}`).map((signal) => signal.index)).toEqual([2]);
  });

  it('is case-sensitive, because two systems write two different electrode names', () => {
    const header = parse(
      buildEdf({
        signals: [
          { label: 'Fp1', samplesPerRecord: 8 },
          { label: 'FP1', samplesPerRecord: 8 },
        ],
        recordCount: 1,
        raw: { startDate: '1.1.2020' },
      }),
    );

    expect(findSignals(header, 'Fp1').map((signal) => signal.index)).toEqual([0]);
    expect(findSignals(header, 'FP1').map((signal) => signal.index)).toEqual([1]);
    expect(findSignals(header, 'fp1')).toEqual([]);
  });

  it('collides labels that differ only in padding', () => {
    // The label on disk is fixed-width and space-padded, so 'T8-P8' and 'T8-P8   ' are the same
    // channel name; a leading space or a NUL pad byte does not make a second channel either.
    const header = parse(
      buildEdf({
        signals: [
          { label: 'T8-P8', samplesPerRecord: 8 },
          { label: 'ignored', samplesPerRecord: 8, raw: { label: ' T8-P8' } },
          { label: 'ignored', samplesPerRecord: 8, raw: { label: `T8-P8${NUL}` } },
        ],
        recordCount: 1,
        raw: { startDate: '1.1.2020' },
      }),
    );

    expect(header.signals.map((signal) => signal.label)).toEqual(['T8-P8', 'T8-P8', 'T8-P8']);
    expect(findSignals(header, 'T8-P8').map((signal) => signal.index)).toEqual([0, 1, 2]);
    expect(header.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'DUPLICATE_SIGNAL_LABEL',
    ]);
  });

  it('finds an annotations channel by its reserved label', () => {
    const header = parse(
      buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        annotationSignals: [{ samplesPerRecord: 30 }],
        recordCount: 2,
        raw: { startDate: '1.1.2020' },
      }),
    );
    const matches = findSignals(header, 'EDF Annotations');

    expect(matches.map((signal) => signal.index)).toEqual([1]);
    expect(matches[0]?.kind).toBe('annotations');
  });
});

describe('getSignal by index', () => {
  it('indexes header.signals directly, duplicates and all', () => {
    expect(getSignal(CHB_MIT_LIKE, 0).label).toBe('FP1-F7');
    expect(getSignal(CHB_MIT_LIKE, 3).label).toBe('T8-P8');
    expect(getSignal(CHB_MIT_LIKE, 3).index).toBe(3);
    expect(getSignal(CHB_MIT_LIKE, 3)).toBe(CHB_MIT_LIKE.signals[3]);
  });

  it('reaches an annotations channel by index', () => {
    const header = parse(
      buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        annotationSignals: [{ samplesPerRecord: 30 }],
        recordCount: 2,
        raw: { startDate: '1.1.2020' },
      }),
    );

    expect(getSignal(header, 1).kind).toBe('annotations');
  });

  it.each([4, 99, -1, 1.5])('throws EdfChannelNotFoundError for index %p', (selector) => {
    const error = notFoundFrom(() => getSignal(CHB_MIT_LIKE, selector));

    expect(error.selector).toBe(selector);
    expect(error.availableLabels).toEqual(ALL_LABELS);
    expect(error.edfErrorKind).toBe('channel');
  });
});

describe('getSignal by label', () => {
  it('returns the one signal carrying a unique label', () => {
    const signal = getSignal(CHB_MIT_LIKE, 'FP1-F7');

    expect(signal.index).toBe(0);
    expect(signal).toBe(CHB_MIT_LIKE.signals[0]);
  });

  it('refuses to choose between duplicates and names every index', () => {
    const error = ambiguousFrom(() => getSignal(CHB_MIT_LIKE, 'T8-P8'));

    expect(error.label).toBe('T8-P8');
    expect(error.matchingIndices).toEqual([1, 3]);
    expect(error.edfErrorKind).toBe('channel');
    // Returning the first of the pair is the failure this class exists to prevent.
    expect(error.matchingIndices).toHaveLength(findSignals(CHB_MIT_LIKE, 'T8-P8').length);
  });

  it('is ambiguous on a padded duplicate label too, because matching is on the trimmed label', () => {
    const error = ambiguousFrom(() => getSignal(CHB_MIT_LIKE, ' T8-P8 '));

    expect(error.label).toBe('T8-P8');
    expect(error.matchingIndices).toEqual([1, 3]);
  });

  it('throws EdfChannelNotFoundError with every available label on a miss', () => {
    const error = notFoundFrom(() => getSignal(CHB_MIT_LIKE, 'Cz'));

    expect(error.selector).toBe('Cz');
    expect(error.availableLabels).toEqual(ALL_LABELS);
    expect(error.availableLabels).toEqual(CHB_MIT_LIKE.signals.map((signal) => signal.label));
  });

  it('treats a label differing only in case as a miss', () => {
    expect(notFoundFrom(() => getSignal(CHB_MIT_LIKE, 't8-p8')).selector).toBe('t8-p8');
  });

  it('is ambiguous for "EDF Annotations" when a file carries two annotation channels', () => {
    // EDF+ requires every annotation channel to be labelled 'EDF Annotations', so this is a
    // conformant file and the diagnostic vocabulary stays silent — but there is still no single
    // signal to return, and header.annotationSignalIndices is the way to address them.
    const header = parse(
      buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        annotationSignals: [{ samplesPerRecord: 30 }, { samplesPerRecord: 30 }],
        recordCount: 2,
        raw: { startDate: '1.1.2020' },
      }),
    );
    const error = ambiguousFrom(() => getSignal(header, 'EDF Annotations'));

    expect(error.matchingIndices).toEqual([1, 2]);
    expect(error.matchingIndices).toEqual([...header.annotationSignalIndices]);
    expect(header.diagnostics).toEqual([]);
  });
});

describe('isAnnotationLabel', () => {
  interface LabelCase {
    readonly name: string;
    readonly label: string;
    readonly annotation: boolean;
  }

  // DESIGN section 5: match the TRIMMED, case-sensitive label; both spellings are accepted for
  // either family, because a BDF+ file written by an EDF+ library carries 'EDF Annotations'.
  const CASES: readonly LabelCase[] = [
    { name: 'the EDF+ reserved label', label: 'EDF Annotations', annotation: true },
    { name: 'the same label as padded on disk', label: 'EDF Annotations ', annotation: true },
    { name: 'padding on either side is not content', label: ' EDF Annotations', annotation: true },
    { name: 'a NUL pad byte is padding too', label: `EDF Annotations${NUL}`, annotation: true },
    { name: 'the BDF+ reserved label', label: 'BDF Annotations', annotation: true },
    { name: 'matching is case-sensitive', label: 'edf annotations', annotation: false },
    { name: 'a longer label is another channel', label: 'EDF Annotations2', annotation: false },
    { name: 'inner spacing is content', label: 'EDF  Annotations', annotation: false },
    { name: 'the family prefix is part of it', label: 'Annotations', annotation: false },
    { name: 'a blank label names nothing', label: '', annotation: false },
  ];

  it.each(CASES)('$name -> $annotation', ({ label, annotation }) => {
    expect(isAnnotationLabel(label)).toBe(annotation);
  });

  it('recognises an EDF-spelled annotations channel inside a BDF+ file', () => {
    const header = parse(
      buildEdf({
        format: 'BDF',
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        annotationSignals: [{ samplesPerRecord: 30, label: 'EDF Annotations' }],
        recordCount: 2,
        raw: { startDate: '1.1.2020' },
      }),
    );

    expect(header.variant).toBe('BDF+C');
    expect(header.signals[1]?.kind).toBe('annotations');
    expect(header.annotationSignalIndices).toEqual([1]);
    expect(header.dataSignalIndices).toEqual([0]);
  });
});
