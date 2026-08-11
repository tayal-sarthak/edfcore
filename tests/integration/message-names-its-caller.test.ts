/**
 * A thrown message never names a function the caller did not call.
 *
 * `envelope.ts` states the rule for its own shared helpers, and 0.3.35 applied it there: hard-coding
 * one of several entry points into a shared refusal named the wrong function for the rest. Two more
 * helpers had the same shape and kept it until 0.3.132-0.3.134 — `readAnnotations` delegates to
 * `decodeAnnotations`, and `sampleStartSecondsOf` is a one-line delegation to `sampleStartTicksOf`,
 * so both reported a name their caller had never written.
 *
 * Asserted at the delegating entry point, which is the side that was wrong.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { sampleStartSecondsOf } from '../../src/sample-locate.js';
import { minimalEdfPlus } from '../support/writer.js';

/** Any `someFunction():` prefix — the shape 0.3.132-0.3.134 removed. */
const NAMES_A_FUNCTION = /\b[a-zA-Z][A-Za-z0-9_]*\(\):/;

async function messageFrom(call: () => unknown): Promise<string> {
  try {
    await call();
    throw new Error('expected a throw');
  } catch (error) {
    return (error as Error).message;
  }
}

describe('a delegating entry point does not report the function it delegates to', () => {
  it('readAnnotations, which calls decodeAnnotations', async () => {
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 2 })));
    for (const call of [
      () => readAnnotations(recording, { start: 0, count: 99 }),
      () => readAnnotations(recording, { start: 0, count: 1 }, { signalIndices: [0] }),
    ]) {
      const message = await messageFrom(call);
      // Not vacuous: these really are the refusals, not some unrelated throw.
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(NAMES_A_FUNCTION);
    }
  });

  it('sampleStartSecondsOf, which calls sampleStartTicksOf', async () => {
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 2 })));
    for (const call of [
      () => sampleStartSecondsOf(recording, 0, 1.5),
      () => sampleStartSecondsOf(recording, 0, 9999),
      () => sampleStartSecondsOf(recording, 99, 0),
      // The annotations channel, refused by the shared resolver.
      () => sampleStartSecondsOf(recording, 1, 0),
    ]) {
      const message = await messageFrom(call);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(NAMES_A_FUNCTION);
    }
  });
});
