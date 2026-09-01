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
