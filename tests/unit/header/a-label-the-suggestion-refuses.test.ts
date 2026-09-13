/**
 * The label list a channel refusal offers, against what `getSignal` will accept.
 *
 * The message ends "Next: pass one of those labels, or select by index", so the list is not
 * decoration — it is the set of things the reader is told to try. It was built one entry per
 * signal, so a label carried by more than one signal appeared more than once and was offered like
 * any other.
 *
 * `getSignal` refuses exactly that label. `EdfAmbiguousChannelError` exists for it and says why:
 * "returning the first is how the wrong channel ends up in a paper". So a reader who took the
 * advice got a second refusal, from the same call, for a label the first refusal had recommended.
 *
 * A repeated label is ordinary rather than exotic. Two annotation channels are conformant EDF+ —
 * `decodeAnnotations` takes a `signalIndices` precisely because a file can have several — and a
 * duplicated data label is common enough that `findSignals` exists to return every match.
 *
 * The count is what keeps the line true of the file and tells the reader which entry needs
 * `findSignals` rather than `getSignal`. `availableLabels` on the error is deliberately untouched:
 * that is the machine-readable list, one entry per signal, in signal order.
 */

import { describe, expect, it } from 'vitest';
import { EdfAmbiguousChannelError, EdfChannelNotFoundError } from '../../../src/errors.js';
import { getSignal } from '../../../src/header/lookup.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfHeader } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

/** Two signals share a label; a third does not. Plus the annotation channel EDF+ requires. */
const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG', samplesPerRecord: 4 },
    { label: 'ECG', samplesPerRecord: 4 },
    { label: 'EEG', samplesPerRecord: 4 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const header = (): EdfHeader => parseHeader(FILE, FILE.byteLength);

const refusalFor = (selector: number | string): string => {
  try {
    getSignal(header(), selector);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

describe('a label two signals carry', () => {
  it('is offered once, with the number that carry it', () => {
    expect(refusalFor('zzz')).toContain('"EEG" (2 signals)');
  });

  it('is not offered twice as though either would do', () => {
    const message = refusalFor('zzz');
    expect(message.match(/"EEG"/g)).toHaveLength(1);
  });

  it('is the label getSignal refuses, which is what made the advice wrong', () => {
    expect(() => getSignal(header(), 'EEG')).toThrow(EdfAmbiguousChannelError);
  });

  it('says the same thing on the index refusal, which shares the list', () => {
    expect(refusalFor(99)).toContain('"EEG" (2 signals)');
  });
});

describe('the labels only one signal carries', () => {
  it('are listed plainly, exactly as before', () => {
    expect(refusalFor('zzz')).toContain('"ECG"');
    expect(refusalFor('zzz')).not.toContain('"ECG" (');
  });

  it('still resolve', () => {
    expect(getSignal(header(), 'ECG').index).toBe(1);
  });
});

describe('the machine-readable list', () => {
  it('still carries one entry per signal, in signal order', () => {
    try {
      getSignal(header(), 'zzz');
      expect.unreachable('a label no signal carries must not resolve');
    } catch (error) {
      expect(error).toBeInstanceOf(EdfChannelNotFoundError);
      expect((error as EdfChannelNotFoundError).availableLabels).toEqual([
        'EEG',
        'ECG',
        'EEG',
        'EDF Annotations',
      ]);
    }
  });
});
