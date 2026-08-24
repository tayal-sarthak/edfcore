/**
 * What a conformant header is allowed to say, which is the half that keeps a report readable.
 *
 * `validateHeader` raises three advisory diagnostics about how a header is written:
 * `LABEL_CONVENTION_NONCONFORMANT`, `PREFILTERING_NONCONFORMANT` and `TRANSDUCER_TYPE_BLANK`.
 * Every one is checked somewhere for the case where it FIRES. What none of them had was a check
 * that it stays quiet, and that is the direction with consequences.
 *
 * A conformance report is only worth reading if a clean file produces a short one. Break an
 * exemption and every recording lights up: `PREFILTERING_NONE` holds four spellings of "no
 * filtering" that EDF+ and real writers use interchangeably, and dropping one of them means every
 * file from that writer carries a warning about a field it filled in correctly. Nobody debugs
 * that. They stop reading the warnings, which are the same warnings that would have told them
 * something real.
 *
 * The headline is the whole of it at once: a header that follows EDF+ to the letter — an
 * `EEG Fpz-Cz` label, a named transducer, `HP:` and `LP:` terms — produces no conformance
 * diagnostics at all. That sentence is the product these three checks exist to make possible, and
 * it was never asserted.
 *
 * One subtlety is pinned deliberately. A label of bare `EEG` IS flagged: the rule is
 * `<type> <sensor>`, and a type with no sensor names a category rather than a channel. The
 * condition that gets that right — the label must be longer than the type it starts with — reads
 * like a redundant length check next to the set membership beside it, and simplifying it away
 * would silently accept `EEG`, `ECG` and `Temp` as channel names.
 *
 * What this does NOT distinguish: the explicit empty-field exemption in `checkPrefiltering` from
 * the token loop below it. A blank field splits into no tokens, and `[].every(...)` is true, so
 * the loop already accepts it — removing the exemption changes no answer. It states the case the
 * function is about rather than adding a reachable one, and the blank field is checked directly
 * because it is a real thing writers emit, not because one line rather than the other handles it.
 *
 * What this does NOT check: that the advice attached to each diagnostic is right. Each says
 * "nothing is affected" and means it — edfcore never infers a channel type from a label, and
 * never parses a filter setting out of prefiltering. That is `open-union-codes.test.ts` and the
 * diagnostic tables' subject.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { validateHeader } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

interface Overrides {
  readonly label?: string;
  readonly transducerType?: string;
  readonly prefiltering?: string;
  /** The 80 bytes as written, for a value the padded spelling above cannot express. */
  readonly raw?: { readonly prefiltering: string };
}

/** One signal, conformant in every field except the ones a case overrides. */
const codesFor = (overrides: Overrides): readonly string[] => {
  const bytes = buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'EEG Fpz-Cz',
        transducerType: 'AgAgCl electrode',
        prefiltering: 'HP:0.1Hz LP:75Hz N:50Hz',
        samplesPerRecord: 8,
        ...overrides,
      },
    ],
  });
  return validateHeader(parseHeader(bytes, bytes.byteLength)).map((one) => one.code);
};

describe('a header that follows EDF+ to the letter', () => {
  it('produces no conformance diagnostics at all', () => {
    // The sentence the three checks exist to make possible. Anything else and the report is noise.
    expect(codesFor({})).toEqual([]);
  });
});

describe('the prefiltering field', () => {
  it.each(['None', 'none', 'NONE', 'No filtering'])(
    'accepts %p, because writers spell it every way',
    (prefiltering) => {
      expect(codesFor({ prefiltering })).toEqual([]);
    },
  );

  it('accepts a blank field, which is not a claim about filtering', () => {
    expect(codesFor({ prefiltering: '' })).toEqual([]);
  });

  it.each(['HP:0.1Hz LP:75Hz N:50Hz', 'HP:0.1Hz', 'G:100', 'LP:75Hz N:50Hz'])(
    'accepts the term form %p',
    (prefiltering) => {
      expect(codesFor({ prefiltering })).toEqual([]);
    },
  );

  it.each(['bandpass', 'HP:0.1Hz oops', '0.1-75Hz'])('still reports %p', (prefiltering) => {
    expect(codesFor({ prefiltering })).toContain('PREFILTERING_NONCONFORMANT');
  });

  /*
   * Whitespace at the ENDS, which `trimEdfField` does not remove.
   *
   * It strips 0x20 and 0x00 and nothing else, so a field padded or separated with a tab or a
   * newline arrives at `checkPrefiltering` with that byte still on it. `split(/\s+/)` then yields an
   * empty token at that end, and the `filter` on the line below is the only thing that stops an
   * empty string being measured against `HP:`/`LP:`/`N:`/`G:` and failing.
   *
   * Nothing had exercised it: every case above is space-separated, and the separator pattern's own
   * `+` collapses an interior run without help. Dropping the filter reports a field whose terms
   * are perfectly well formed, on the writers most likely to have used a tab in the first place.
   */
  it.each([
    ['a leading tab', '\tHP:0.1Hz'],
    ['a trailing tab', 'HP:0.1Hz\t'],
    ['a leading newline', '\nHP:0.1Hz LP:75Hz'],
    ['tabs between the terms', 'HP:0.1Hz\tLP:75Hz'],
  ])('accepts %s, which trimEdfField leaves behind', (_name, prefiltering) => {
    expect(codesFor({ raw: { prefiltering: prefiltering.padEnd(80, ' ') } })).toEqual([]);
  });

  it('still reports a bad term with whitespace around it', () => {
    // Non-vacuity: tolerating the edges is not tolerating the contents.
    expect(codesFor({ raw: { prefiltering: '\tbandpass\t'.padEnd(80, ' ') } })).toContain(
      'PREFILTERING_NONCONFORMANT',
    );
  });
});

describe('the label field', () => {
  it.each(['EEG Fpz-Cz', 'ECG II', 'Temp rectal', 'Resp oro-nasal'])(
    'accepts %p, which is "<type> <sensor>"',
    (label) => {
      expect(codesFor({ label })).toEqual([]);
    },
  );

  it.each(['EEG', 'ECG', 'Temp'])('reports the bare type %p, which names no channel', (label) => {
    // The length condition, stated as its own case. It reads like a redundant check beside the
    // set membership, and without it a category becomes an acceptable channel name.
    expect(codesFor({ label })).toContain('LABEL_CONVENTION_NONCONFORMANT');
  });

  it.each(['EEGFpz', 'Fp1', 'C3-P3'])('reports %p, which has no type at all', (label) => {
    expect(codesFor({ label })).toContain('LABEL_CONVENTION_NONCONFORMANT');
  });
});

describe('the transducer field', () => {
  it('accepts anything it is given', () => {
    expect(codesFor({ transducerType: 'thermistor' })).toEqual([]);
  });

  it('reports only a blank one', () => {
    expect(codesFor({ transducerType: '' })).toEqual(['TRANSDUCER_TYPE_BLANK']);
  });
});
