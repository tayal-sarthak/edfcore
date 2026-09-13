/**
 * The READ options, passed as a bare value.
 *
 * 0.6.155 refused an `AbortSignal` handed to a read in place of the object carrying it, and the
 * argument there was that no earlier guard could see it: `typeof options === 'object'` is true of
 * an `AbortSignal`. This is the other half — the plain bare value, which that guard walked past
 * because it was looking for an object.
 *
 * It is the shape the rest of the package has been closing one entry point at a time since
 * 0.6.130: `cachedSource(source, 4 * 1024 * 1024)`, `openEdf(source, true)`,
 * `httpSource(url, token)`, `validateRecording(recording, true)`, `formatHeader(header, true)`.
 * Every option is a field on an object, so the value a caller means IS the option.
 *
 * The read options are where the number is likeliest to be written, because
 * `maxMaterializeBytes` is a byte count and a caller who has decided on one writes it.
 * `readRecords(recording, selection, 64 * 1024 * 1024)` took the 256 MiB default instead — on the
 * one option whose job is to refuse an allocation before it is attempted — and any `signal` meant
 * alongside it went too. The read was neither bounded nor cancellable, and it resolved with data.
 *
 * The guard sits in `assertReadOptions`, which every adapter reaches through `throwIfAborted`, so
 * every call that ends in a read is covered by one check.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

type Call = (recording: EdfRecording, options: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  [
    'readRecords',
    (recording, options) =>
      readRecords(
        recording,
        { signalIndices: [0], records: { start: 0, count: 1 } },
        options as never,
      ),
  ],
  [
    'readWindow',
    (recording, options) =>
      readWindow(
        recording,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 1 },
        options as never,
      ),
  ],
  [
    'readAnnotations',
    (recording, options) => readAnnotations(recording, { start: 0, count: 6 }, options as never),
  ],
  [
    'streamRecords',
    async (recording, options) => {
      for await (const chunk of streamRecords(
        recording,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 1 },
        options as never,
      )) {
        return chunk;
      }
      return undefined;
    },
  ],
  [
    'readEnvelope',
    (recording, options) =>
      readEnvelope(
        recording,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 2, buckets: 4 },
        options as never,
      ),
  ],
  [
    'readEnvelopeAtResolution',
    (recording, options) =>
      readEnvelopeAtResolution(
        recording,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 2, secondsPerBucket: 1 },
        options as never,
      ),
  ],
  ['inspectEdf', (_recording, options) => inspectEdf(byteSource(FILE), options as never)],
  [
    'source.read',
    (recording, options) => recording.source.read(0, 16, options as never) as Promise<unknown>,
  ],
];

describe.each(CALLS)('%s, given a bare value where the read options belong', (_name, call) => {
  it.each([
    ['a byte count, meant as maxMaterializeBytes', 64 * 1024 * 1024],
    ['a boolean', true],
    ['a string', '64MB'],
  ])('refuses %s rather than taking the defaults', async (_shape, options) => {
    const recording = await opened();
    const thrown = await call(recording, options).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the call resolved with the options dropped').toBeDefined();
    expect(thrown?.message).toContain('maxMaterializeBytes and signal are fields on one');
    expect(thrown?.message).toContain('Next:');
  });

  it('still reads with no options at all', async () => {
    await expect(call(await opened(), undefined)).resolves.toBeDefined();
  });

  it('still takes an options object, and honours what is on it', async () => {
    await expect(call(await opened(), { maxMaterializeBytes: 1024 * 1024 })).resolves.toBeDefined();
  });
});

describe('openEdf, whose options carry both families', () => {
  /*
   * `OpenOptions` extends `ParseOptions` and `ReadOptions`, so a bare value there could be either
   * mistake. It names `strict` — the only boolean among these options, and what a bare `true`
   * plainly means — and it does so BEFORE the first read is issued, which is the only reason the
   * read guard does not get there first. The fix is the same sentence either way.
   */
  it.each([
    ['a boolean', true],
    ['a byte count', 64 * 1024 * 1024],
  ])('refuses %s, naming the option its own signature is about', async (_shape, options) => {
    await expect(openEdf(byteSource(FILE), options as never)).rejects.toThrow(
      /strict is a field on one/,
    );
  });

  it('still opens with no options at all', async () => {
    await expect(openEdf(byteSource(FILE))).resolves.toBeDefined();
  });
});

describe('the budget the bare number was meant to be', () => {
  it('still refuses a read above it when it is passed as a field', async () => {
    const recording = await opened();
    await expect(
      readRecords(
        recording,
        { signalIndices: [0], records: { start: 0, count: 6 } },
        { maxMaterializeBytes: 1 },
      ),
    ).rejects.toThrow(/maxMaterializeBytes/);
  });

  it('leaves the AbortSignal refusal of 0.6.155 saying its own thing', async () => {
    const recording = await opened();
    await expect(
      recording.source.read(0, 16, new AbortController().signal as never),
    ).rejects.toThrow(/signal is a field on the options/);
  });
});
