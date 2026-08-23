/**
 * The one required option with no default, refused in edfcore's own words.
 *
 * `reading-signals.md` explains why `signalIndices` has no "all signals" default: so that a
 * 256-channel file "is never read wholesale because an argument was left off". The absence is the
 * feature — `header.dataSignalIndices` is the explicit spelling of "all of them", and typing it
 * out is the point.
 *
 * Which makes omitting it a caller mistake the API is designed around, and it was the one bad
 * argument on this path that said nothing useful about itself. TypeScript catches it at a typed
 * call site, and TypeScript is not the only way in: a selection built from JSON, from a config
 * file, from a JavaScript call site, or from an object spread that dropped a key arrives at run
 * time. Until 0.4.442 all four paths answered with `TypeError: signalIndices is not iterable` —
 * no `Next:` clause, no mention of edfcore, and nothing naming the option, in a package where
 * every other bad argument here says what to pass instead. `readWindow` already refused a
 * non-finite `startSeconds` with a sentence and a next step; the array beside it did not.
 *
 * The message carries no caller prefix, for the reason `resolveSignals` carries none: it is shared
 * by `readWindow`, `readRecords`, `streamRecords` and both envelope calls, and a hard-coded name
 * would be wrong for all but one of them. `envelope.test.ts` records exactly that mistake being
 * made once already, by three functions sharing two helpers.
 *
 * All five entry points are checked, because "the same refusal everywhere" is the claim — two
 * different resolvers implement it, and 0.3.35 is what happens when they drift.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const open = (): Promise<EdfRecording> =>
  openEdf(byteSource(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 })));

type Call = (recording: EdfRecording, bad: unknown) => Promise<unknown>;

/**
 * Every entry point that takes a selection, given one with `signalIndices` set to `bad`.
 *
 * The type arguments are given to `new Map` rather than left to the annotation: inference reads
 * the first entry and then rejects the rest, because these return five different things.
 */
const CALLS: ReadonlyMap<string, Call> = new Map<string, Call>([
  [
    'readRecords',
    (recording, bad) =>
      readRecords(recording, { records: { start: 0, count: 1 }, signalIndices: bad } as never),
  ],
  [
    'readWindow',
    (recording, bad) =>
      readWindow(recording, {
        startSeconds: 0,
        durationSeconds: 1,
        signalIndices: bad,
      } as never),
  ],
  [
    'streamRecords',
    async (recording, bad) => {
      // Drained rather than only started: the generator validates before its first yield, and
      // a caller who never iterates never learns anything either way.
      const chunks = [];
      for await (const chunk of streamRecords(recording, {
        startSeconds: 0,
        durationSeconds: 1,
        signalIndices: bad,
      } as never)) {
        chunks.push(chunk);
      }
      return chunks;
    },
  ],
  [
    'readEnvelope',
    (recording, bad) =>
      readEnvelope(recording, {
        startSeconds: 0,
        durationSeconds: 1,
        buckets: 4,
        signalIndices: bad,
      } as never),
  ],
  [
    'readEnvelopeAtResolution',
    (recording, bad) =>
      readEnvelopeAtResolution(recording, {
        startSeconds: 0,
        durationSeconds: 1,
        secondsPerBucket: 1,
        signalIndices: bad,
      } as never),
  ],
]);

const refusalOf = async (call: Call, bad: unknown): Promise<Error | undefined> => {
  const recording = await open();
  return call(recording, bad).then(
    () => undefined,
    (thrown: unknown) => thrown as Error,
  );
};

describe('the page still says why there is no default', () => {
  it('names the file it exists to protect', () => {
    expect((DOCS_PAGES.get('reading-signals.md') ?? '').replace(/\s+/g, ' ')).toContain(
      'a 256-channel file is never read wholesale because an argument was left off',
    );
  });
});

describe.each([...CALLS.entries()])('%s', (_name, call) => {
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['a single number, unwrapped', 0],
    ['a string', '0,1'],
    ['an object', { 0: 1 }],
  ])('refuses a selection whose signalIndices is %s', async (_shape, bad) => {
    const failure = await refusalOf(call, bad);
    expect(failure, 'the call resolved with no selection').toBeDefined();
    // Not a raw TypeError about iteration: it names the option and what to pass.
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure?.message).toContain('signalIndices');
    expect(failure?.message).toContain('Next:');
    expect(failure?.message).toContain('header.dataSignalIndices');
    expect(failure?.message).not.toContain('is not iterable');
  });

  it('says why the default is missing rather than only that it is', async () => {
    // The reason is the answer to "why can I not just omit it?", which is the next thing a caller
    // asks — and the page's argument, brought to the call site.
    expect((await refusalOf(call, undefined))?.message).toContain('256-channel file');
  });

  it('still accepts an empty array, which is a selection of nothing', async () => {
    // Distinct from omitting it: a caller who computed an empty list asked for nothing, and that
    // is answerable. Only a value that is not a list at all is a mistake.
    const recording = await open();
    await expect(call(recording, [])).resolves.toBeDefined();
  });
});

describe('the refusal is the same wherever it comes from', () => {
  it('does not name a caller, since two resolvers serve five entry points', async () => {
    const messages = new Set<string>();
    for (const call of CALLS.values()) {
      messages.add((await refusalOf(call, undefined))?.message ?? '');
    }
    expect(messages.size, 'the entry points disagree about the message').toBe(1);
    expect([...messages][0]).not.toContain('()');
  });
});
