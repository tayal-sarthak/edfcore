/**
 * A signal passed to the calls that resolve a label to one.
 *
 * `getSignal(header, signal)` is the answer handed back as the question — a helper that takes
 * "a channel" and calls `getSignal` on it whatever it was given. It was refused as "an object",
 * and told to try `matchSignals` for a RegExp or a predicate, which it is neither.
 */

import { describe, expect, it } from 'vitest';
import { byteSource, findSignals, getSignal, openEdf } from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

describe('a signal passed as the selector', () => {
  it.each([
    ['getSignal', getSignal],
    ['findSignals', findSignals],
  ] as const)('%s() says it already is one', async (call, run) => {
    const { header } = await openEdf(byteSource(minimalEdf()));
    const signal = header.signals[0];
    if (signal === undefined) throw new Error('fixture has no signal');
    expect(() => run(header, signal as never)).toThrow(
      `${call}(): the selector is a signal already, which is what this call resolves a label to. ` +
        'Next: use it as it is, or pass signal.label to look it up again.',
    );
    expect(run(header, signal.label)).toBeDefined();
  });

  it('keeps the pattern advice for a RegExp', async () => {
    const { header } = await openEdf(byteSource(minimalEdf()));
    expect(() => getSignal(header, /EEG/ as never)).toThrow('matchSignals(header, pattern)');
  });
});
