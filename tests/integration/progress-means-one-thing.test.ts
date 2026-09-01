/**
 * Progress means the same thing whichever call you asked it of.
 *
 * `onProgress` is the one callback in the reading API, and `types.ts` declares it twice with the
 * same signature — on `BuildIndexOptions` and on `ValidateOptions`. Two declarations, two
 * consumers, one contract, and nothing compared them. That is the shape this project keeps
 * meeting: `originTicks` and `startOffsetTicks` are one quantity consumed at two sites and each
 * caused its own defect, and `whole-api.test.ts` puts the general form plainly — a function can be
 * individually correct and still disagree with its neighbour.
 *
 * The contract is not written down in one place either. `scanOnsets` states the half that matters
 * most, in a comment about the case where it has nothing to read: `onProgress` is still called
 * once, "with the traversal complete, so a caller's bar finishes". A bar is what the option is
 * for, and a bar that never finishes is the failure. Everything else follows from being a bar:
 * `total` cannot change under it, `done` cannot go backwards, and no call may arrive after the
 * promise has already resolved.
 *
 * So both consumers are put through every shape in the matrix and asked the same six questions.
 * Two of them were failing until 0.5.67 and 0.5.68 — a file with no records finished neither bar,
 * and a validation that skipped its traversal finished nothing at all.
 *
 * The consumers are enumerated out of `src/` rather than listed, so a third one fails this file
 * until it joins it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';

const SRC = new URL('../../src/', import.meta.url);

/** Every module that calls the caller's progress callback, found rather than listed. */
function callSites(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const text = readFileSync(new URL(entry.name, directory), 'utf8');
      if (text.includes('onProgress?.(')) found.push(`${prefix}${entry.name}`);
    }
  };
  walk(SRC, '');
  return found.sort();
}

interface Call {
  readonly done: number;
  readonly total: number;
  /** True when the call arrived after the promise had already resolved. */
  readonly late: boolean;
}

interface Run {
  readonly calls: readonly Call[];
  readonly recordCount: number;
}

type Consumer = (
  bytes: Uint8Array,
  onProgress: (done: number, total: number) => void,
) => Promise<number>;

const CONSUMERS: ReadonlyArray<readonly [string, Consumer]> = [
  [
    'buildRecordIndex',
    async (bytes, onProgress) => {
      const recording = await openEdf(byteSource(bytes));
      await buildRecordIndex(recording, { onProgress });
      return recording.header.recordCount;
    },
  ],
  [
    'validateRecording, sweeping the samples',
    async (bytes, onProgress) => {
      const recording = await openEdf(byteSource(bytes));
      await validateRecording(recording, { onProgress, scanSamples: true });
      return recording.header.recordCount;
    },
  ],
  [
    'validateRecording, reading as little as it can',
    async (bytes, onProgress) => {
      const recording = await openEdf(byteSource(bytes));
      await validateRecording(recording, { onProgress, scanSamples: false });
      return recording.header.recordCount;
    },
  ],
];

async function observe(consumer: Consumer, bytes: Uint8Array): Promise<Run> {
  const calls: Call[] = [];
  let settled = false;
  const recordCount = await consumer(bytes, (done, total) => {
    calls.push({ done, total, late: settled });
  });
  settled = true;
  // A callback fired from a floating promise would land here rather than above.
  await Promise.resolve();
  return { calls, recordCount };
}

describe('the consumers this file covers are all of them', () => {
  it('finds the two modules that call onProgress, and no third', () => {
    expect(callSites()).toEqual(['record-index.ts', 'validate.ts']);
    expect(AWKWARD).toHaveLength(10);
  });
});

for (const [name, consumer] of CONSUMERS) {
  describe(`${name} keeps the bar honest`, () => {
    for (const file of AWKWARD) {
      it(`over ${file.name}`, async () => {
        const { calls, recordCount } = await observe(consumer, file.bytes);

        // 1. It reports at all. An operation that finished without saying so leaves a bar stuck.
        expect(calls.length).toBeGreaterThan(0);
        // 2. The total is the record count, on every call, so a percentage has a fixed divisor.
        expect(calls.map((call) => call.total)).toEqual(calls.map(() => recordCount));
        // 3. Done never goes backwards.
        const done = calls.map((call) => call.done);
        expect([...done].sort((a, b) => a - b)).toEqual(done);
        // 4. Done stays inside the total it was measured against.
        expect(done.filter((value) => value < 0 || value > recordCount)).toEqual([]);
        // 5. The last call says finished, which is the whole reason a caller asked.
        expect(done[done.length - 1]).toBe(recordCount);
        // 6. Nothing arrives after the promise resolved.
        expect(calls.filter((call) => call.late)).toEqual([]);
      });
    }
  });
}

describe('and the two agree on the same file', () => {
  it('finishes at the same number, which is the point of one option for two calls', async () => {
    for (const file of AWKWARD) {
      const [index, sweep] = [
        await observe(CONSUMERS[0]?.[1] as Consumer, file.bytes),
        await observe(CONSUMERS[1]?.[1] as Consumer, file.bytes),
      ];
      const last = (run: Run): Call | undefined => run.calls[run.calls.length - 1];
      expect(last(index)?.done, file.name).toBe(last(sweep)?.done);
      expect(last(index)?.total, file.name).toBe(last(sweep)?.total);
    }
  });
});
