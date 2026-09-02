/**
 * The file shapes the corpus supplies, built rather than downloaded.
 *
 * `tests/corpus/whole-api.test.ts` runs essentially the whole barrel over six real files and
 * asserts the results agree with each other. Its docblock says why that is a class of its own: a
 * function can be individually correct and still disagree with its neighbour, and a function can be
 * correct on the fixtures written to exercise it and throw on the first real file with a zero
 * record duration, a duplicate label, or no signals at all.
 *
 * All of it skips without `npm run corpus:fetch`, so a fresh clone never ran any of it. What those
 * files supply is not realness — the agreement properties do not care where the bytes came from —
 * it is AWKWARDNESS, and the writer can produce that. Each entry below is one shape the corpus
 * happens to contain, named after what makes it awkward rather than after the file it came from.
 *
 * Anything using this list should assert `AWKWARD.length` rather than trusting it, so a shape
 * removed from here fails the test that was relying on it.
 */

import { setHeaderField } from './corrupt.js';
import { buildEdf, type EdfSpec } from './writer.js';

export interface AwkwardFile {
  readonly name: string;
  /** What this shape breaks if a helper was written against a tidy file. */
  readonly awkward: string;
  readonly bytes: Uint8Array;
}

const spec = (overrides: EdfSpec): Uint8Array => buildEdf(overrides);

export const AWKWARD: readonly AwkwardFile[] = [
  {
    name: 'plain EDF, one signal',
    awkward: 'the tidy case, so a failure elsewhere is about the shape and not about the helper',
    bytes: spec({
      format: 'EDF',
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    }),
  },
  {
    name: 'EDF+C with annotations',
    awkward: 'an annotations channel sits among the signals and is not one of them',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 8 },
        { label: 'Resp', samplesPerRecord: 3 },
      ],
      annotationSignals: [
        { samplesPerRecord: 40, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r % 2}`] }] },
      ],
    }),
  },
  {
    name: 'EDF+D with a gap',
    awkward: 'the record onsets are not the nominal grid, so span and coverage differ',
    bytes: spec({
      format: 'EDF',
      plus: 'D',
      recordCount: 8,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r) => (r < 4 ? r : r + 5),
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [
        { samplesPerRecord: 40, tals: (r) => [{ onset: r < 4 ? r : r + 5, texts: ['mark'] }] },
      ],
    }),
  },
  {
    name: 'zero record duration',
    awkward: 'every sampleRateHz is undefined and nothing may divide by the duration',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 0,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [
        { samplesPerRecord: 40, tals: (r) => [{ onset: r, texts: ['Sleep stage W'] }] },
      ],
    }),
  },
  {
    name: 'annotations only, no data signal',
    awkward:
      'dataSignalIndices is empty, which a "for each signal" loop treats as a file with none',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [],
      annotationSignals: [
        { samplesPerRecord: 40, tals: (r) => [{ onset: r, texts: ['Sleep stage 1'] }] },
      ],
    }),
  },
  {
    name: 'duplicate channel labels',
    awkward: 'a label no longer identifies a channel, so getSignal cannot answer',
    bytes: spec({
      format: 'EDF',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [
        { label: 'ECG', samplesPerRecord: 4 },
        { label: 'ECG', samplesPerRecord: 4 },
      ],
    }),
  },
  {
    name: 'BDF, 24-bit samples',
    awkward: 'bytesPerSample is 3, so every byte offset is a multiple nothing else in EDF uses',
    bytes: spec({
      format: 'BDF',
      recordCount: 5,
      recordDurationSeconds: 2,
      signals: [
        { label: 'A1', samplesPerRecord: 8 },
        { label: 'Status', samplesPerRecord: 8 },
      ],
    }),
  },
  {
    name: 'a signal with no usable scale',
    awkward: 'signal.scale is undefined, so anything reaching for physical units must refuse',
    bytes: spec({
      format: 'EDF',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Flat', samplesPerRecord: 4, digitalMinimum: 0, digitalMaximum: 0 },
        { label: 'Fp1', samplesPerRecord: 4 },
      ],
    }),
  },
  {
    name: 'no records at all',
    awkward:
      'recordCount is 0, so every span is zero, every window is empty, and openEdf probes nothing',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 0,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
    }),
  },
  {
    name: 'a gap and a sub-second start at once',
    awkward:
      'the two things that hide each other: t = 0 is not the header start time, AND the onsets ' +
      'are not the nominal grid, so a derivation that gets either one right alone is still wrong',
    bytes: spec({
      format: 'EDF',
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      startOffsetSeconds: 0.25,
      recordOnsetSeconds: (r) => (r < 3 ? 0.25 + r : 0.25 + r + 5),
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
    }),
  },
  {
    name: 'records that overlap in time',
    awkward:
      'each record starts before the one before it ended, so two records claim the same instant — ' +
      'the case a gap list carries with a NEGATIVE duration, mergeChunks refuses to join, and a ' +
      'window resolver cannot answer with one record index',
    bytes: spec({
      format: 'EDF',
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (record) => record * 0.5,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
    }),
  },
  {
    name: 'BDF+D: 24-bit samples and a gap at once',
    awkward:
      'every other BDF shape here runs end to end and every other discontinuous one is 16-bit, so ' +
      'a three-byte stride and a chunk boundary that is not the nominal grid had never met — and ' +
      'a byte offset that is right for one is wrong for the other',
    bytes: spec({
      format: 'BDF',
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (record) => (record < 3 ? record : record + 7),
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
    }),
  },
  {
    name: 'two annotation signals',
    awkward:
      'EDF+ allows more than one annotations channel and only the FIRST carries the timekeeping ' +
      'TAL, so a helper that finds "the" annotations signal picks one and loses the events in the ' +
      'other — and the two channels have different widths, so a fixed stride is wrong as well',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [
        {
          samplesPerRecord: 30,
          tals: (record) => (record === 0 ? [{ onset: '+0.5', texts: ['scored by A'] }] : []),
        },
        {
          samplesPerRecord: 20,
          tals: (record) => (record === 1 ? [{ onset: '+1.5', texts: ['scored by B'] }] : []),
        },
      ],
    }),
  },
  {
    name: 'a download that stopped part way',
    awkward:
      'the header promises more records than the bytes hold, and the last of the bytes is half a ' +
      'record — so recordCount is smaller than the field says, the final record is not exposed, ' +
      'and every span is shorter than the file claims',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
    }).slice(0, -30),
  },
  {
    name: 'a record duration with no exact binary form',
    awkward:
      '0.29 s cannot be written in float64, so recordCount * recordDurationSeconds lands just ' +
      'under the true span and floors to a whole second less — the arithmetic every duration in ' +
      'this package is computed in ticks to avoid',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 100,
      recordDurationSeconds: 0.29,
      signals: [{ label: 'Fp1', samplesPerRecord: 29 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
    }),
  },
  {
    name: 'a record count the header never gave',
    awkward:
      'the count came from the source length rather than from the field, so header.recordCount ' +
      'disagrees with the bytes at offset 236 and every derived span rests on arithmetic instead ' +
      'of on a number the file states',
    bytes: setHeaderField(
      spec({
        format: 'EDF',
        plus: 'C',
        recordCount: 5,
        recordDurationSeconds: 1,
        signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
        annotationSignals: [{ samplesPerRecord: 20 }],
      }),
      'recordCount',
      '-1',
    ),
  },
  {
    name: 'a single record',
    awkward:
      'the first record and the last are the same one, so the two probes openEdf makes are one',
    bytes: spec({
      format: 'EDF',
      plus: 'C',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
    }),
  },
];
