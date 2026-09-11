/**
 * The three lookups, called without the selector they look up.
 *
 * `getSignal`, `findSignals` and `matchSignals` each take a selector the caller supplies, and
 * none of them checked it. Omitting it made the failure depend on the FILE rather than on the
 * call — which is the shape 0.6.79 found in `readTriggers` and closed on the reading API:
 *
 * - `findSignals(header)` and `getSignal(header)` reached `trimEdfField(undefined)` and threw
 *   V8's "Cannot read properties of undefined (reading 'length')".
 * - `matchSignals(header)` returned `[]` on a file with no data signals, because the predicate is
 *   never called there, and threw "test is not a function" on every other file — leaking an
 *   internal name, and answering "no channels match" to a question nobody asked.
 *
 * A selector arrives from a montage in a config file, a channel name in a URL, or a spread that
 * dropped a key at least as often as it is written out. That is the argument `assertSignalIndices`
 * already makes for the other required argument in this package (fixed in 0.6.86).
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { findSignals, getSignal, matchSignals } from '../../src/header/lookup.js';
import { parseHeader } from '../../src/header/parse.js';
import { buildEdf } from '../support/writer.js';

const header = (bytes: Uint8Array) => parseHeader(bytes, bytes.length);

/** Two data signals: the file where the old failure was a thrown internal name. */
const WITH_SIGNALS = header(
  buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [
      { label: 'Fp1', samplesPerRecord: 4 },
      { label: 'Cz', samplesPerRecord: 4 },
    ],
  }),
);

/** Annotations only: the file where `matchSignals` used to answer `[]` instead. */
const NO_DATA_SIGNALS = header(
  buildEdf({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [],
    annotationSignals: [{ samplesPerRecord: 40 }],
  }),
);

const LOOKUPS: ReadonlyArray<readonly [string, (header: unknown) => unknown]> = [
  ['getSignal', (h) => (getSignal as (h: unknown) => unknown)(h)],
  ['findSignals', (h) => (findSignals as (h: unknown) => unknown)(h)],
  ['matchSignals', (h) => (matchSignals as (h: unknown) => unknown)(h)],
];

describe.each(LOOKUPS)('%s with no selector', (name, call) => {
  it('is refused on a file with data signals', () => {
    expect(() => call(WITH_SIGNALS)).toThrow(RangeError);
  });

  it('is refused the same way on a file with none, so the file cannot change the answer', () => {
    expect(() => call(NO_DATA_SIGNALS)).toThrow(RangeError);
    let withSignals = '';
    let without = '';
    try {
      call(WITH_SIGNALS);
    } catch (error) {
      withSignals = (error as Error).message;
    }
    try {
      call(NO_DATA_SIGNALS);
    } catch (error) {
      without = (error as Error).message;
    }
    expect(withSignals).toBe(without);
  });

  it('names the call and what it accepts, and leaks no internal', () => {
    try {
      call(WITH_SIGNALS);
    } catch (error) {
      const { message } = error as Error;
      expect(message).toContain(`${name}(): the selector is missing`);
      expect(message).toMatch(/Next: pass /);
      expect(message).not.toContain('test is not a function');
      expect(message).not.toContain('Cannot read properties');
      expect(isEdfError(error)).toBe(false);
    }
  });
});

describe('a selector that is there', () => {
  it('still resolves a label, an index, a pattern and a predicate', () => {
    expect(getSignal(WITH_SIGNALS, 'Cz').index).toBe(1);
    expect(getSignal(WITH_SIGNALS, 0).label).toBe('Fp1');
    expect(findSignals(WITH_SIGNALS, 'Fp1')).toHaveLength(1);
    expect(matchSignals(WITH_SIGNALS, /^C/)).toHaveLength(1);
    expect(matchSignals(WITH_SIGNALS, (label) => label.startsWith('F'))).toHaveLength(1);
  });

  it('still answers nothing for a file with no data signals', () => {
    expect(matchSignals(NO_DATA_SIGNALS, /.*/)).toEqual([]);
  });
});
