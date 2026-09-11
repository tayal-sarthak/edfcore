/**
 * The refusal `--limit -1` earns, and the rule it names.
 *
 * `parseArgs` refuses two different things under one message: a value that is not a safe integer,
 * and a value below zero. Until 0.6.50 the message named only the first — "`--limit` needs a
 * whole number, received -1" — which is a rule `-1` satisfies. A reader with a shell variable
 * that had gone negative was told their input was not the kind of thing it plainly was, and the
 * `Next:` clause said "pass a count", which is what they thought they had done.
 *
 * Every other guard in the package names both halves, because every other one rejects both:
 * `bytes/view.ts` and `io/source.ts` say "non-negative safe integer", `envelope.ts` and
 * `stream.ts` say "positive whole number". This is the one that did not.
 *
 * `cli-limit-default.test.ts` pins the number the message offers as the way back, and
 * `limit-zero.test.ts` covers the smallest value it accepts. This covers the values below it.
 */

import { describe, expect, it } from 'vitest';
import { CliUsageError, parseArgs } from '../../src/cli-run.js';

/** The message `parseArgs` refuses this argv with, or `undefined` if it accepted it. */
function refusal(value: string): string | undefined {
  try {
    parseArgs(['header', 'night.edf', '--limit', value]);
    return undefined;
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(CliUsageError);
    return (thrown as Error).message;
  }
}

describe('a negative --limit', () => {
  it('is refused', () => {
    expect(refusal('-1')).toBeDefined();
  });

  it('is not refused for not being a whole number, because it is one', () => {
    const message = refusal('-1') ?? '';
    expect(Number.isSafeInteger(Number('-1'))).toBe(true);
    expect(message).not.toMatch(/needs a whole number/);
    expect(message).toContain('non-negative');
  });

  it('is quoted back, so the reader can see which argument was read', () => {
    expect(refusal('-1')).toContain('received -1');
  });
});

describe('the other half of the same guard', () => {
  it('still refuses a value that really is not a whole number', () => {
    expect(refusal('3.5')).toContain('received 3.5');
    expect(refusal('all')).toContain('received all');
  });

  it('accepts zero, which is the boundary the message describes', () => {
    expect(refusal('0')).toBeUndefined();
  });
});
