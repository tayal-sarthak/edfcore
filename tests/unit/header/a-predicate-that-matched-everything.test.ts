/**
 * `matchSignals(header, async (label) => …)`, which matched every channel in the file.
 *
 * `assertMatcher` checks that the matcher is a function. Nothing checked what it answers with. An
 * `async` function answers with a Promise, a Promise is always truthy, so every data signal passed
 * the filter — and the call that exists to narrow a montage returned the whole recording.
 *
 * This is the selector, which is what makes it the worst place for it. `assertSignalIndices` states
 * the rule a read is built on: "there is no 'all signals' default, so that the whole of a
 * 256-channel file is never read because an argument was omitted". An async predicate produces
 * exactly that outcome through an argument that WAS supplied, so nothing about the call looks
 * careless.
 *
 * A montage lookup is where it comes from. `isInMontage(label)` against IndexedDB, a config file or
 * a server is async, and the predicate wrapping it is the obvious thing to write.
 *
 * Tested on the first signal's answer, not by inspecting the function: `AsyncFunction` is not the
 * only way to return a Promise — a plain function whose body returns one does too — and what matters
 * is the value. A `.then` property read, never a call, which is the rule `describeValue`'s own
 * Promise branch follows.
 *
 * A predicate returning a truthy non-boolean is NOT refused. `(label) => label.length` is ordinary
 * JavaScript and the caller means it; a Promise is the one truthy value nobody means.
 */

import { describe, expect, it } from 'vitest';
import { matchSignals } from '../../../src/header/lookup.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfHeader } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fp1', samplesPerRecord: 4 },
    { label: 'EEG C3', samplesPerRecord: 4 },
    { label: 'ECG', samplesPerRecord: 4 },
  ],
  annotationSignals: [{ samplesPerRecord: 16 }],
});

const header = (): EdfHeader => parseHeader(FILE, FILE.byteLength);

type Match = (header: EdfHeader, match: unknown) => readonly { label: string }[];
const match = matchSignals as unknown as Match;

const refusal = (call: () => unknown): string => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

describe('a predicate that answers with a Promise', () => {
  it('is refused rather than matching the whole file', () => {
    const message = refusal(() =>
      match(header(), async (label: string) => label.startsWith('EEG')),
    );
    expect(message).toContain('the predicate returned a pending Promise');
    expect(message).toContain('every data signal in the file would have matched');
  });

  it('is refused for a plain function that returns one too', () => {
    const notDeclaredAsync = (label: string): unknown => Promise.resolve(label.startsWith('EEG'));
    expect(refusal(() => match(header(), notDeclaredAsync))).toContain('a pending Promise');
  });

  it('says to resolve first and match against the resolved value', () => {
    const message = refusal(() => match(header(), async () => true));
    expect(message).toContain('make the predicate synchronous');
    expect(message).toContain('then match against the resolved value');
  });

  it('is a caller mistake, so it is a plain RangeError', () => {
    expect(() => match(header(), async () => true)).toThrow(RangeError);
  });

  it('is refused even when the Promise would have resolved to false', () => {
    // Which is the point: the answer never mattered, only its truthiness.
    expect(refusal(() => match(header(), async () => false))).toContain('a pending Promise');
  });

  it('does not await, settle or subscribe to what it was given', () => {
    const neverSettles = () => new Promise<never>(() => {});
    expect(refusal(() => match(header(), neverSettles))).toContain('a pending Promise');
  });
});

describe('what the old behaviour produced', () => {
  it('was every data signal, and the annotations channel still excluded', () => {
    // Pinned as the thing the refusal replaces: three data channels, all of them.
    const all = matchSignals(header(), () => true);
    expect(all.map((signal) => signal.label)).toEqual(['EEG Fp1', 'EEG C3', 'ECG']);
  });
});

describe('the predicates that still work', () => {
  it('include a synchronous one, which is the whole point of the call', () => {
    const eeg = matchSignals(header(), (label) => label.startsWith('EEG'));
    expect(eeg.map((signal) => signal.label)).toEqual(['EEG Fp1', 'EEG C3']);
  });

  it('include a truthy non-boolean, which is ordinary JavaScript', () => {
    const matched = match(header(), (label: string) => label.length as unknown);
    expect(matched).toHaveLength(3);
  });

  it('include one that matches nothing', () => {
    expect(matchSignals(header(), () => false)).toHaveLength(0);
  });

  it('and a RegExp, which never had this problem', () => {
    expect(matchSignals(header(), /^EEG/).map((signal) => signal.label)).toEqual([
      'EEG Fp1',
      'EEG C3',
    ]);
  });
});

describe('the guards above it', () => {
  it('keep their own sentences', () => {
    expect(refusal(() => match(header(), 'EEG'))).toContain('the matcher is the string "EEG"');
    expect(refusal(() => match(header(), {}))).toContain('the matcher is an object');
  });
});
