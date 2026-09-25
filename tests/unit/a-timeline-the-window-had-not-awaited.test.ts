/**
 * The timeline `resolveTimeWindow` maps a window onto, one keyword short.
 *
 * "it has no spanTicks" is true of a pending Promise, and true of almost everything else, which is
 * the objection 0.6.217 raised for the three calls that take a header. The timeline is reached the
 * same way and had the same sentence: `buildTimeline(source, header)` is the published way to get
 * one without opening a recording, and it is async.
 *
 * The advice was the part that could not be acted on. "Pass recording.timeline" names a field on an
 * object a caller reaching for `buildTimeline` has deliberately not built — `buildTimeline` is what
 * `openEdf` itself calls to make one — so the reader was sent to the call they were avoiding.
 *
 * And the keyword is only half of it. `buildTimeline` resolves to a PAIR, `{ timeline, index }`, so
 * `await` alone still does not produce a timeline: the awaited value has no `spanTicks` either and
 * earns the very message that was already wrong. Both halves are named in one sentence, because a
 * caller who has made one of these mistakes is about to make the other.
 *
 * The existing refusal stays for the shapes it was written for: a header, a recording, a record
 * index, an object built by hand. Those genuinely have no `spanTicks`.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildTimeline } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import type { EdfTimeline } from '../../src/types.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();

async function open() {
  return openEdf(byteSource(bytes));
}

describe('resolveTimeWindow given the Promise buildTimeline returns', () => {
  it('names the keyword rather than the field it has no value for', async () => {
    const recording = await open();
    const pending = buildTimeline(recording.source, recording.header);
    expect(() =>
      resolveTimeWindow(pending as unknown as EdfTimeline, recording.index, 0, 1),
    ).toThrow(/pending Promise/);
    await pending;
  });

  it('says the resolved value is a pair, so await alone is not the whole fix', async () => {
    const recording = await open();
    const pending = buildTimeline(recording.source, recording.header);
    let message = '';
    try {
      resolveTimeWindow(pending as unknown as EdfTimeline, recording.index, 0, 1);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('resolves to a pair carrying the timeline');
    expect(message).toContain('.timeline');
    await pending;
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const recording = await open();
    const pending = buildTimeline(recording.source, recording.header);
    expect(() =>
      resolveTimeWindow(pending as unknown as EdfTimeline, recording.index, 0, 1),
    ).toThrow(RangeError);
    await pending;
  });
});

describe('the pair itself, awaited but not unwrapped', () => {
  it('still gets the refusal written for a value with no spanTicks', async () => {
    const recording = await open();
    const pair = await buildTimeline(recording.source, recording.header);
    expect(() => resolveTimeWindow(pair as unknown as EdfTimeline, recording.index, 0, 1)).toThrow(
      /has no spanTicks/,
    );
  });

  it('and its timeline field is what the call takes', async () => {
    const recording = await open();
    const { timeline, index } = await buildTimeline(recording.source, recording.header);
    expect(resolveTimeWindow(timeline, index, 0, 1)).toHaveLength(1);
  });
});

describe('the shapes the old sentence was written for', () => {
  it('still hear it — a header has no spanTicks', async () => {
    const recording = await open();
    expect(() =>
      resolveTimeWindow(recording.header as unknown as EdfTimeline, recording.index, 0, 1),
    ).toThrow(/has no spanTicks/);
  });

  it('still hear it — so does the recording that carries the timeline', async () => {
    const recording = await open();
    expect(() =>
      resolveTimeWindow(recording as unknown as EdfTimeline, recording.index, 0, 1),
    ).toThrow(/pass recording.timeline/);
  });
});
