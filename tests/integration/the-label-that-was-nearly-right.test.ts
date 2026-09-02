/**
 * A label that differs only in case is named, and the list of labels is capped.
 *
 * `lookup.ts` explains why matching is exact and case-sensitive: `'Fp1'` and `'FP1'` are written by
 * different systems and edfcore has no montage vocabulary to decide they are the same electrode. So
 * a case mismatch is refused, and the message said "matching is exact on the trimmed label and is
 * case-sensitive" — while holding the label that proves that is what went wrong, and printing it in
 * a list of every other label in the file for the reader to spot.
 *
 * That decision is about which signal comes back. It was never a reason to make the reader do the
 * comparison. Nothing about what is returned changes here: the call still throws.
 *
 * The list was the other half. Every listing this package prints is capped — 24 bytes of hex, 16 of
 * field evidence, twenty diagnostics, `--limit` events — and this was the one that was not, in the
 * one message whose length grows with the file. A mistyped label on a 512-signal recording put five
 * thousand characters on one line behind `edfcore: `, and `inspect.ts` names a 512-signal file as
 * the realistic one. `availableLabels` on the error still carries all of them, so nothing a program
 * reads was capped.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

async function headerOf(labels: readonly string[]): Promise<EdfHeader> {
  const recording = await openEdf(
    byteSource(
      buildEdf({
        recordCount: 2,
        recordDurationSeconds: 1,
        signals: labels.map((label) => ({ label, samplesPerRecord: 4 })),
      }),
    ),
  );
  return recording.header;
}

function refusal(header: EdfHeader, selector: string | number): EdfChannelNotFoundError {
  try {
    getSignal(header, selector);
  } catch (error) {
    if (error instanceof EdfChannelNotFoundError) return error;
    throw error;
  }
  throw new Error('the selector resolved, so there is no refusal to read');
}

describe('a label that differs only in case', () => {
  it('is named, rather than left in the list to be spotted', async () => {
    const header = await headerOf(['Fp1', 'Fp2', 'EEG Fpz-Cz']);
    const message = refusal(header, 'FP1').message;
    expect(message).toContain('This file has "Fp1", which differs only in case or spacing.');
    expect(message).toContain('Next: pass "Fp1", or select by index.');
  });

  it('is named for a spacing difference too, which is the other way a label is retyped', async () => {
    const header = await headerOf(['EEG Fpz-Cz', 'Fp2']);
    expect(refusal(header, 'EEG  Fpz-Cz').message).toContain('This file has "EEG Fpz-Cz"');
  });

  it('comes first in the list, where a reader looks', async () => {
    const header = await headerOf(['A1', 'A2', 'A3', 'Fp1']);
    const message = refusal(header, 'fp1').message;
    expect(message).toContain('in signal order: "Fp1", "A1", "A2", "A3"');
  });

  it('is still refused, because the matching rule did not change', async () => {
    const header = await headerOf(['Fp1']);
    expect(() => getSignal(header, 'FP1')).toThrow(EdfChannelNotFoundError);
    expect(getSignal(header, 'Fp1').label).toBe('Fp1');
  });
});

describe('a label that is nothing like any of them', () => {
  it('gets the message it always got', async () => {
    const header = await headerOf(['Fp1', 'Fp2']);
    const message = refusal(header, 'ECG').message;
    expect(message).not.toContain('differs only in case');
    expect(message).toContain('Next: pass one of those labels, or select by index.');
    expect(message).toContain('"Fp1", "Fp2"');
  });
});

describe('the list of labels', () => {
  it('is capped, and says how many it withheld', async () => {
    const header = await headerOf(Array.from({ length: 40 }, (_, index) => `S${index}`));
    const message = refusal(header, 'nope').message;
    expect(message).toContain('and 28 more');
    expect(message).toContain('"S11"');
    expect(message).not.toContain('"S12"');
  });

  it('is uncapped on an ordinary file, so the notice means something', async () => {
    const header = await headerOf(['Fp1', 'Fp2', 'ECG']);
    expect(refusal(header, 'nope').message).not.toContain('more');
  });

  it('leaves every label on the error, which is what a program reads', async () => {
    const labels = Array.from({ length: 40 }, (_, index) => `S${index}`);
    const header = await headerOf(labels);
    expect(refusal(header, 'nope').availableLabels).toEqual(labels);
  });

  it('caps the out-of-range index message the same way, which shares the helper', async () => {
    const header = await headerOf(Array.from({ length: 40 }, (_, index) => `S${index}`));
    const message = refusal(header, 99).message;
    expect(message).toContain('and 28 more');
    expect(message).toContain('Next: pass an index in 0..39, or a label.');
  });
});

describe('the message contract', () => {
  it('holds either way: a Next: clause and the labels it is about', async () => {
    const header = await headerOf(['Fp1']);
    for (const selector of ['FP1', 'ECG']) {
      const message = refusal(header, selector).message;
      expect(message).toContain('Next: ');
      expect(message).toContain('"Fp1"');
    }
  });

  it('folds case without a locale, which is what keeps the output deterministic', async () => {
    // `toLocaleLowerCase` folds "I" to a dotless "ı" under a Turkish locale. This uses the
    // locale-free one, so a file with an "I" in a label behaves the same everywhere.
    const header = await headerOf(['EMG Chin I']);
    expect(refusal(header, 'emg chin i').message).toContain('This file has "EMG Chin I"');
  });
});
