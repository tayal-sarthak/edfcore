/**
 * `buildTimeline`'s second argument, which nothing checked at all.
 *
 * 0.6.106 guarded the first one, for the confusion between this call's shape and its sibling's:
 * "`buildRecordIndex` takes the recording, and this one takes the source and the header separately,
 * because it is what `openEdf` calls to BUILD a recording and there is none yet." The header beside
 * it was left open.
 *
 * It is the argument with the forgotten `await` in it. `api-reading.md` writes the pair out as
 * `await buildTimeline(source, header)`, and the header on that line comes from `readHeader(source)`
 * — which is async. So `buildTimeline(source, readHeader(source))` is the documented call one
 * keyword short, and `recordCount` read back `undefined` without complaining before
 * `hasTimekeeping` reached `header.annotationSignalIndices.length` and threw V8's `Cannot read
 * properties of undefined`: a `TypeError` naming an internal field, with no `Next:` clause, from a
 * published export.
 *
 * Checked on `signals`, which is what every other header guard in the package checks, and the
 * pending Promise is named the way 0.6.217, 0.6.229 and 0.6.232 name it.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { buildTimeline } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('a header that had not arrived', () => {
  it('no longer throws the engine TypeError from inside hasTimekeeping', async () => {
    const source = byteSource(FILE);
    const pending = readHeader(source);
    const thrown = await refusal(() => buildTimeline(source, pending as never));
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown.message).not.toContain('Cannot read properties');
    await pending;
  });

  it('names the keyword and the call that produced it', async () => {
    const source = byteSource(FILE);
    const pending = readHeader(source);
    const thrown = await refusal(() => buildTimeline(source, pending as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is a pending Promise, not a header');
    expect(thrown.message).toContain('await readHeader(source)');
    expect(thrown.message).toContain('it resolves to the header this takes');
    await pending;
  });

  it('says the same thing the other header guards say', async () => {
    const source = byteSource(FILE);
    const pending = readHeader(source);
    const { validateHeader } = await import('../../src/validate.js');
    const fromTimeline = await refusal(() => buildTimeline(source, pending as never));
    const fromValidate = await refusal(() => validateHeader(pending as never));
    expect(fromTimeline.message).toContain('that is a pending Promise, not a header');
    expect(fromValidate.message).toContain('that is a pending Promise, not a header');
    await pending;
  });
});

describe('something that is simply not a header', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['an empty object', {}],
  ])('is refused in edfcore words rather than by V8: %s', async (_shape, given) => {
    const thrown = await refusal(() => buildTimeline(byteSource(FILE), given as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is not a header — it has no signals');
    expect(thrown.message).toContain('Next:');
  });

  it('says what this call in particular reads off it', async () => {
    const thrown = await refusal(() => buildTimeline(byteSource(FILE), {} as never));
    expect(thrown.message).toContain(
      'reads the annotation channels off it to find the timekeeping',
    );
  });

  it('names both ways a header is produced', async () => {
    const thrown = await refusal(() => buildTimeline(byteSource(FILE), {} as never));
    expect(thrown.message).toContain('readHeader(source)');
    expect(thrown.message).toContain('parseHeader(bytes, sourceByteLength)');
  });

  it('refuses a chunk, whose signals carry samples rather than declarations', async () => {
    const recording = await openEdf(byteSource(FILE));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    // A chunk's `signals` IS an array, so the shape test lets it through — which is why it needs
    // its own branch, as `validateHeader` and the three lookups each do.
    const thrown = await refusal(() => buildTimeline(recording.source, chunks[0] as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is a chunk, not a header');
    expect(thrown.message).toContain('entries carry samples');
    expect(thrown.message).toContain('Next: pass recording.header');
  });
});

describe('the first argument keeps the 0.6.106 refusal', () => {
  it('still names the pair this call takes', async () => {
    const recording = await openEdf(byteSource(FILE));
    const thrown = await refusal(() => buildTimeline(recording as never, recording.header));
    expect(thrown.message).toContain('that is a recording, and this call takes the source and the');
    expect(thrown.message).toContain('buildRecordIndex(recording)');
  });
});

describe('the documented call', () => {
  it('still builds a timeline from a source and an awaited header', async () => {
    const source = byteSource(FILE);
    const header = await readHeader(source);
    const { timeline, index } = await buildTimeline(source, header);
    expect(timeline.recordCount).toBe(4);
    expect(index.recordCount).toBe(4);
  });
});
