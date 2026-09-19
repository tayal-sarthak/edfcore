/**
 * `EdfChannelNotFoundError.selector`, declared `string | number`, carrying an `EdfSignal`.
 *
 * Every guard that raises this error hands over the value it REFUSED, and one of them refuses a
 * whole signal. `signalIndices: matchSignals(header, /EEG/)` is the selection 0.6.174 exists for —
 * the lookups return `EdfSignal`s and the selection wants their indices — so the error a reader
 * most often sees carried `label`, `scale`, `recordByteOffset`, `raw` and the rest into a field
 * whose type says a label or an index. About 850 bytes of it, through
 * `console.error(error.selector)` and into a log line.
 *
 * This is the shape 0.6.213 fixed for `EdfRangeError`: a typed payload carrying the raw refused
 * argument, narrowed in the constructor "rather than at each guard, so no later one can reintroduce
 * it". A signal's own `index` is the selector the message tells the caller to pass, so that is what
 * survives; anything the type never described is left empty.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { getSignal, matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EEG Pz-Oz', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const refusalFor = async (signalIndices: unknown): Promise<EdfChannelNotFoundError> => {
  const thrown = await readWindow(await opened(), {
    signalIndices: signalIndices as never,
    startSeconds: 0,
    durationSeconds: 2,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
  return thrown as EdfChannelNotFoundError;
};

describe('the signal a lookup returned, where an index belongs', () => {
  it('keeps the index it spells rather than the signal it came on', async () => {
    const recording = await opened();
    const error = await refusalFor([getSignal(recording.header, 'EEG Pz-Oz')]);
    expect(error.selector).toBe(1);
    expect(typeof error.selector).toBe('number');
  });

  it('no longer carries a record layout into a log line', async () => {
    const recording = await opened();
    const signal = getSignal(recording.header, 'EEG Fpz-Cz');
    // What it used to be worth serialising, against what it is now.
    expect(JSON.stringify(signal).length).toBeGreaterThan(400);
    const error = await refusalFor(matchSignals(recording.header, /EEG/));
    expect(JSON.stringify(error.selector).length).toBeLessThan(8);
    expect(JSON.stringify(error.selector)).not.toContain('recordByteOffset');
  });

  it('leaves the message saying what it always said', async () => {
    const recording = await opened();
    const error = await refusalFor(matchSignals(recording.header, /EEG/));
    expect(error.message).toContain('holds a signal rather than an index');
    expect(error.availableLabels).toEqual(['EEG Fpz-Cz', 'EEG Pz-Oz', 'EDF Annotations']);
  });
});

describe('the selectors the type does describe', () => {
  it('passes a label and an index through untouched', async () => {
    expect((await refusalFor(['EEG Fpz-Cz'])).selector).toBe('EEG Fpz-Cz');
    expect((await refusalFor([99])).selector).toBe(99);
    expect((await refusalFor([1.5])).selector).toBe(1.5);
    expect((await refusalFor(['9'])).selector).toBe('9');
  });

  it('is empty for a value that is neither, rather than holding it', async () => {
    for (const value of [{}, { index: '0' }, null, [] as unknown]) {
      const error = await refusalFor([value]);
      expect(error.selector, JSON.stringify(value)).toBeUndefined();
    }
  });

  it('narrows in the constructor, so a guard added later cannot reintroduce it', () => {
    const error = new EdfChannelNotFoundError('made directly', {
      selector: { index: 2, label: 'EMG Chin' } as never,
      availableLabels: ['EMG Chin'],
    });
    expect(error.selector).toBe(2);
  });
});
