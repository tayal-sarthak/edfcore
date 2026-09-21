/**
 * `validateHeader`, given what `readHeader` returns without awaiting it.
 *
 * The header a caller has in hand comes from `readHeader(source)` whenever they have a source
 * rather than bytes, and that call is async — so `validateHeader(readHeader(source))` is one
 * keyword short, and the whole of what it was told is that the argument has no signals. True of a
 * pending Promise, and true of almost everything else, so it named nothing a reader could act on.
 *
 * This guard is otherwise a copy of the one in `header/lookup.ts`, which got exactly this branch in
 * 0.6.217, with the same reasoning: "the next step names `parseHeader`, which is synchronous — but
 * the call a reader reaches for when they have a SOURCE rather than bytes is `readHeader`, and that
 * one is async". 0.6.89 made the argument for the recording and 0.6.214 taught `describeValue` to
 * say it, which covers every message reading its subject out of that helper. This one names its
 * subject in fixed text, and `edfcore/validate` is a separate entry point — the copy nobody carried
 * it to.
 *
 * `validateRecording` already names the keyword for its own argument, so the module's two exported
 * checks now agree.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { validateHeader, validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('a header that had not arrived', () => {
  it('names the keyword rather than the missing field', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = refusal(() => validateHeader(pending as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('a pending Promise, not a header');
    expect(thrown.message).not.toContain('it has no signals');
    await pending;
  });

  it('names the call to await, which is the one that produced it', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = refusal(() => validateHeader(pending as never));
    expect(thrown.message).toContain('await readHeader(source)');
    expect(thrown.message).toContain('it resolves to the header this takes');
    await pending;
  });

  it('still answers once it has arrived', async () => {
    const header = await readHeader(byteSource(FILE));
    expect(Array.isArray(validateHeader(header))).toBe(true);
  });

  it('says the same thing the lookups have said since 0.6.217', async () => {
    const pending = readHeader(byteSource(FILE));
    const { getSignal } = await import('../../src/header/lookup.js');
    const fromValidate = refusal(() => validateHeader(pending as never));
    const fromLookup = refusal(() => getSignal(pending as never, 0));
    expect(fromValidate.message).toContain('that is a pending Promise, not a header');
    expect(fromLookup.message).toContain('that is a pending Promise, not a header');
    await pending;
  });
});

describe('the sibling this module exports beside it', () => {
  it('already names the keyword for an unawaited recording', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await Promise.resolve()
      .then(() => validateRecording(pending as never))
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
    expect(thrown?.message).toContain('await openEdf(source)');
    await pending;
  });
});

describe('everything else keeps its refusal', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['an empty object', {}],
  ])('keeps the 0.6.113 refusal for %s', (_shape, given) => {
    const thrown = refusal(() => validateHeader(given as never));
    expect(thrown.message).toContain('that is not a header — it has no signals');
    expect(thrown.message).toContain('validateRecording(recording)');
  });

  it('keeps the chunk refusal, which a signals array of samples earns', async () => {
    const recording = await openEdf(byteSource(FILE));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const thrown = refusal(() => validateHeader(chunks[0] as never));
    expect(thrown.message).toContain('that is a chunk, not a header');
  });

  it('keeps the recording refusal, which names the sweep that reads records', async () => {
    const recording = await openEdf(byteSource(FILE));
    const thrown = refusal(() => validateHeader(recording as never));
    expect(thrown.message).toContain('that is not a header — it has no signals');
  });
});
