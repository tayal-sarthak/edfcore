/**
 * A BDF carrying two channels labelled `Status`.
 *
 * `getSignal` refuses a duplicate label and states why: "there is no answer edfcore could return
 * that would not be a guess", because "returning the first is how the wrong channel ends up in a
 * paper". It throws `EdfAmbiguousChannelError` carrying the indices, so a caller can pick.
 *
 * `getStatusSignal` resolves the same ambiguity the other way. It walked the data signals and
 * returned the first match, so a file with two `Status` channels produced one of them with nothing
 * saying a choice had been made — and `readTriggers` decoded the whole recording's triggers off
 * it. This is the one path in the package where a missing event is indistinguishable from no
 * events, which is the argument 0.6.120 makes for this same function's other refusal.
 *
 * A BDF with two Status channels is malformed. That is precisely the file this package exists to
 * be careful with, and nothing on the reading path consults the diagnostics that would flag it.
 *
 * The ordinary cases are untouched: one Status channel resolves, none returns `undefined`, and a
 * 16-bit file returns `undefined` without looking at labels at all.
 */

import { describe, expect, it } from 'vitest';
import { getStatusSignal, readTriggers } from '../../src/biosemi.js';
import { EdfAmbiguousChannelError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const bdf = (labels: readonly string[]): Uint8Array =>
  buildEdf({
    format: 'BDF',
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: labels.map((label) => ({ label, samplesPerRecord: 8 })),
    annotationSignals: [{ samplesPerRecord: 40 }],
  });

const headerOf = async (labels: readonly string[]): Promise<EdfHeader> =>
  (await openEdf(byteSource(bdf(labels)))).header;

describe('two channels labelled Status', () => {
  it('is refused rather than resolved to the first', async () => {
    const header = await headerOf(['Status', 'Status']);
    expect(() => getStatusSignal(header)).toThrow(EdfAmbiguousChannelError);
  });

  it('is a file defect, so isEdfError says true, and it carries the indices', async () => {
    const header = await headerOf(['EEG1', 'Status', 'Status']);
    let thrown: unknown;
    try {
      getStatusSignal(header);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(true);
    expect((thrown as EdfAmbiguousChannelError).matchingIndices).toEqual([1, 2]);
    expect((thrown as EdfAmbiguousChannelError).label).toBe('Status');
  });

  it('says what returning the first would have cost, and how to pick', async () => {
    const header = await headerOf(['Status', 'Status']);
    expect(() => getStatusSignal(header)).toThrow(
      /this file has 2 signals labelled "Status" \(indices 0, 1\), so getStatusSignal cannot choose one/,
    );
    expect(() => getStatusSignal(header)).toThrow(
      /would date every trigger in the recording to a channel nobody picked/,
    );
    expect(() => getStatusSignal(header)).toThrow(/Next: select the one you mean with getSignal/);
  });

  it('reaches readTriggers, which is the call that would have used the guess', async () => {
    const recording = await openEdf(byteSource(bdf(['Status', 'Status'])));
    await expect(readTriggers(recording, { startSeconds: 0, durationSeconds: 1 })).rejects.toThrow(
      EdfAmbiguousChannelError,
    );
  });
});

describe('what the refusal leaves alone', () => {
  it('resolves the one Status channel a real BioSemi file has', async () => {
    const header = await headerOf(['EEG1', 'Status']);
    expect(getStatusSignal(header)?.label.trim()).toBe('Status');
    expect(getStatusSignal(header)?.index).toBe(1);
  });

  it('still answers undefined for a BDF with no Status channel', async () => {
    expect(getStatusSignal(await headerOf(['EEG1', 'EEG2']))).toBeUndefined();
  });

  it('still answers undefined for a 16-bit file, whatever its labels say', async () => {
    const header = (
      await openEdf(
        byteSource(
          buildEdf({
            format: 'EDF',
            plus: 'C',
            recordCount: 2,
            recordDurationSeconds: 1,
            signals: [
              { label: 'Status', samplesPerRecord: 8 },
              { label: 'Status', samplesPerRecord: 8 },
            ],
            annotationSignals: [{ samplesPerRecord: 40 }],
          }),
        ),
      )
    ).header;
    expect(getStatusSignal(header)).toBeUndefined();
  });
});
