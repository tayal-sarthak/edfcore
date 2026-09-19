/**
 * The index guard's own advice, followed without the keyword.
 *
 * `segmentAt`, `gapAt` and `contiguityOf` share one refusal, and its next step is "pass
 * recording.index, or the index buildRecordIndex(recording) returns". That second call is ASYNC. So a
 * reader who takes the advice and forgets the `await` hands these three a pending Promise — and gets
 * the same sentence back, pointing at the same call:
 *
 *     contiguityOf(buildRecordIndex(recording))
 *
 * 0.6.89 coined the phrase for the recording and said why it earns a branch: a message that names a
 * field rather than the argument says "nothing about the one keyword that fixes it". 0.6.214 taught
 * `describeValue` to say it, which covers every message that reads its subject out of that helper.
 * This family names its subject in fixed text, and it is the one whose advice leads here.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, contiguityOf, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
  recordOnsetSeconds: (r) => (r < 4 ? r : r + 5),
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const CALLS: ReadonlyArray<readonly [string, (index: unknown) => unknown]> = [
  ['segmentAt', (index) => segmentAt(index as never, 1)],
  ['gapAt', (index) => gapAt(index as never, 1)],
  ['contiguityOf', (index) => contiguityOf(index as never)],
];

describe.each(CALLS)('%s, given what buildRecordIndex returns without awaiting it', (_n, call) => {
  it('names the keyword rather than the missing field', async () => {
    const recording = await opened();
    const pending = buildRecordIndex(recording);
    let thrown: Error | undefined;
    try {
      call(pending);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('a pending Promise, not a record index');
    expect(thrown?.message).not.toContain('it has no `coverage`');
    await pending;
  });

  it('no longer sends a reader back to the call they just made', async () => {
    const recording = await opened();
    const pending = buildRecordIndex(recording);
    const thrown = ((): Error | undefined => {
      try {
        call(pending);
        return undefined;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(thrown?.message).toContain('await buildRecordIndex(recording)');
    expect(thrown?.message).toContain('it resolves to the index this takes');
    await pending;
  });

  it('keeps its own reason, which differs per call', async () => {
    const recording = await opened();
    const pending = buildRecordIndex(recording);
    const thrown = ((): Error | undefined => {
      try {
        call(pending);
        return undefined;
      } catch (error) {
        return error as Error;
      }
    })();
    // `because` is the sentence the three do not share, and it survives the new branch.
    expect(thrown?.message).toMatch(/, and .+\. Next:/);
    await pending;
  });

  it('keeps the 0.6.91 refusal for something that is simply not an index', async () => {
    const recording = await opened();
    let thrown: Error | undefined;
    try {
      call(recording);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain('it has no `coverage`');
    expect(thrown?.message).toContain('Next: pass recording.index');
  });

  it('still answers for an index that was awaited', async () => {
    // The complete one: `segmentAt` and `gapAt` refuse a probed index for their own documented
    // reason, which is a different refusal from this one.
    const complete = await buildRecordIndex(await opened());
    expect(() => call(complete)).not.toThrow();
  });
});
