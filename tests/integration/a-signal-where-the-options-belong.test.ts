/**
 * An `AbortSignal` passed as the read options rather than as the field on them.
 *
 * 0.6.130, 0.6.140 and 0.6.154 each refused a bare value where an options object belongs, always
 * on the same argument: every option in this package is a field on an object, so the value a
 * caller means IS the option. This is that mistake made with an OBJECT, which is why none of those
 * guards can see it — `typeof options === 'object'` is true of an `AbortSignal`.
 *
 * It is also the likeliest spelling of it. The field is named `signal`, the thing the caller holds
 * is named `signal`, and `fetch(url, signal)` for `fetch(url, { signal })` is a mistake this
 * ecosystem makes constantly; `readWindow(recording, selection, controller.signal)` reads as
 * correct at the call site.
 *
 * The failure is silent in the worst possible way. `options?.signal` was `undefined`, so the read
 * ran to completion and RESOLVED WITH DATA — and a read that resolves with data is exactly what an
 * abort that lost the race looks like, which is the ordinary outcome a caller already handles. A
 * viewer that cancels on every scroll cancelled nothing, and neither the reads nor their memory
 * stopped.
 *
 * Every adapter reaches this through `throwIfAborted`; `httpSource` resolves the effective signal
 * itself and carries its own call.
 *
 * The boundary is the options that CARRY a signal. `cachedSource(source, options)` takes block and
 * budget sizes and no signal, so a signal passed there is 0.6.140's case rather than this one.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording, FetchLike, HttpResponseLike, ReadOptions } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r}`] }] },
  ],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

type Call = (recording: EdfRecording, options: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  [
    'readRecords',
    (recording, options) =>
      readRecords(
        recording,
        { signalIndices: [0], records: { start: 0, count: 2 } },
        options as ReadOptions,
      ),
  ],
  [
    'readWindow',
    (recording, options) =>
      readWindow(
        recording,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 2 },
        options as ReadOptions,
      ),
  ],
  [
    'readAnnotations',
    (recording, options) => readAnnotations(recording, { start: 0, count: 6 }, options as never),
  ],
  ['buildRecordIndex', (recording, options) => buildRecordIndex(recording, options as never)],
  [
    'streamRecords',
    async (recording, options) => {
      for await (const chunk of streamRecords(
        recording,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 2 },
        options as ReadOptions,
      )) {
        return chunk;
      }
      return undefined;
    },
  ],
  [
    'source.read',
    (recording, options) =>
      recording.source.read(0, 16, options as ReadOptions) as Promise<unknown>,
  ],
];

describe.each(CALLS)('%s, given the signal itself', (_name, call) => {
  it('refuses rather than resolving with data the caller had cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const recording = await opened();
    const thrown = await call(recording, controller.signal).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the read resolved with the cancellation dropped').toBeDefined();
    expect(thrown?.message).toContain('signal is a field on the options');
    expect(thrown?.message).toContain('Next:');
  });

  it('refuses a signal that has not aborted too, since the wiring is wrong either way', async () => {
    const recording = await opened();
    const thrown = await call(recording, new AbortController().signal).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('signal is a field on the options');
  });

  it('refuses the published AbortSignalLike shim, which is named by shape', async () => {
    const recording = await opened();
    const thrown = await call(recording, { aborted: false }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('signal is a field on the options');
  });

  it('still aborts when the signal is on the field, as an AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    const recording = await opened();
    const thrown = await call(recording, { signal: controller.signal }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.name).toBe('AbortError');
  });

  it('still reads with no options at all', async () => {
    await expect(call(await opened(), undefined)).resolves.toBeDefined();
  });
});

describe('openEdf, which reads the header', () => {
  it('refuses the signal in the options position', async () => {
    const controller = new AbortController();
    await expect(openEdf(byteSource(FILE), controller.signal as never)).rejects.toThrow(
      /signal is a field on the options/,
    );
  });
});

describe('the options that carry no signal', () => {
  it('leaves cachedSource() to the guard that owns its own options', async () => {
    // Block and budget sizes, with no signal among them, so this is 0.6.140's case and not this
    // one. Asserted so that a later change here has to decide about it rather than drift into it.
    const source = cachedSource(byteSource(FILE), new AbortController().signal as never);
    await expect(source.read(0, 16)).resolves.toBeDefined();
  });

  it('still guards the per-read options of a cached source', async () => {
    const source = cachedSource(byteSource(FILE));
    await expect(source.read(0, 16, new AbortController().signal as never)).rejects.toThrow(
      /signal is a field on the options/,
    );
  });
});

/**
 * `httpSource` resolves the effective signal itself rather than going through `throwIfAborted`,
 * so it carries the guard separately and has to be shown to.
 */
describe('httpSource, the one adapter with its own copy', () => {
  const HREF = 'https://data.example.org/night.edf';

  /** Answers exactly the bytes the Range asked for; the point here is the options, not the read. */
  const fetchImpl = ((_href: string, init?: Record<string, unknown>) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? '';
    const bounds = /bytes=(\d+)-(\d+)/.exec(range);
    const length = bounds === null ? 0 : Number(bounds[2]) - Number(bounds[1]) + 1;
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: { get: (): null => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(length)),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;

  it('refuses a signal passed as the read options', async () => {
    const source = await httpSource(HREF, { fetch: fetchImpl, byteLength: 64 });
    await expect(source.read(0, 8, new AbortController().signal as never)).rejects.toThrow(
      /signal is a field on the options/,
    );
  });

  it('still reads when the signal is on the field', async () => {
    const source = await httpSource(HREF, { fetch: fetchImpl, byteLength: 64 });
    await expect(
      source.read(0, 8, { signal: new AbortController().signal as never }),
    ).resolves.toHaveLength(8);
  });
});
