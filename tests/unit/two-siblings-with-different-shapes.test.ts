/**
 * `buildTimeline` and `buildRecordIndex`, each handed the other's argument.
 *
 * They are exported side by side from one module and take different shapes. `buildRecordIndex`
 * takes the recording; `buildTimeline` takes the source and the header separately, because it is
 * what `openEdf` calls to BUILD a recording and there is none yet. Nothing about the names says so.
 *
 * So `buildTimeline(recording)` read `undefined.recordCount` and `buildRecordIndex(header)` read
 * `undefined.recordCount` too — the same V8 message from two different functions, naming a field
 * rather than either argument (fixed in 0.6.106).
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, buildTimeline } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { ByteSource, EdfHeader, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = () => openEdf(byteSource(BYTES));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

async function refusal(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

describe('buildTimeline given the recording', () => {
  it('says it takes the two halves, and why there is no recording yet', async () => {
    const recording = await opened();
    const message = await refusal(() =>
      buildTimeline(loosely<ByteSource>(recording), loosely<EdfHeader>(undefined)),
    );
    expect(message).toContain('buildTimeline(): that is a recording');
    expect(message).toContain('it is what builds a recording, so there is none yet');
    expect(message).toContain('Next: pass (recording.source, recording.header)');
  });

  it('names the sibling that does take one', async () => {
    const recording = await opened();
    expect(
      await refusal(() => buildTimeline(loosely<ByteSource>(recording), recording.header)),
    ).toContain('buildRecordIndex(recording)');
  });

  it('refuses anything else as a source', async () => {
    expect(
      await refusal(() => buildTimeline(loosely<ByteSource>(BYTES), loosely<EdfHeader>({}))),
    ).toContain('a ByteSource is needed');
  });

  it('still builds from the two halves', async () => {
    const recording = await opened();
    const built = await buildTimeline(recording.source, recording.header);
    expect(built.timeline.recordCount).toBe(4);
  });
});

describe('buildRecordIndex given the header', () => {
  it('names it as a header and says what a full scan also needs', async () => {
    const recording = await opened();
    const message = await refusal(() => buildRecordIndex(loosely<EdfRecording>(recording.header)));
    expect(message).toContain('buildRecordIndex(): that is a header');
    expect(message).toContain('the source and the timeline too');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['the source', 'source'],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    const value = given === 'source' ? recording.source : given;
    expect(await refusal(() => buildRecordIndex(loosely<EdfRecording>(value)))).toContain(
      'the recording is not the object openEdf() returns',
    );
  });

  it('says nothing about an internal field either of them read first', async () => {
    const recording = await opened();
    for (const message of [
      await refusal(() => buildRecordIndex(loosely<EdfRecording>(recording.header))),
      await refusal(() => buildTimeline(loosely<ByteSource>(recording), recording.header)),
    ]) {
      expect(message).not.toContain('Cannot read properties');
      expect(message).not.toContain('recordCount');
    }
  });

  it('still scans a real recording', async () => {
    const recording = await opened();
    expect((await buildRecordIndex(recording)).coverage).toBe('complete');
  });
});
