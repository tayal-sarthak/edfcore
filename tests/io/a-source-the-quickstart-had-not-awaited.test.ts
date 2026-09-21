/**
 * `openEdf(fileSource("recording.edf"))` — the Node quickstart, one keyword short.
 *
 * `fileSource(path)` is the only async adapter in the package: it opens the file to learn its size,
 * so it returns a Promise. `assertByteSource` answered that Promise with its generic list, whose
 * middle item is `fileSource(path) from "edfcore/node" for a file` — the call the reader had just
 * made. 0.6.215 named this shape for the index guard: advice a reader follows and arrives back
 * where they started.
 *
 * It is the first call of the package, and the list is reached from five places — `openEdf`,
 * `readHeader`, `readRecordBytes` and `inspectEdf` all take a source, and `cachedSource` wraps one.
 *
 * Naming the keyword is worth more than naming the shape here, because exactly one call in this
 * package needs it: `byteSource`, `blobSource` and `httpSource` are synchronous, and a reader who
 * knows which one is async knows where the `await` goes.
 *
 * Every other wrong argument keeps the adapter it had, including the recording named in 0.6.222.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { fileSource } from '../../src/node.js';
import { openEdf } from '../../src/recording.js';
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

/** Never opened: the guard runs before any read, so the path need not exist. */
const pendingSource = (): unknown => {
  const pending = fileSource('/nonexistent/recording.edf');
  void pending.catch(() => undefined);
  return pending;
};

const CALLS: ReadonlyArray<readonly [string, (source: unknown) => unknown]> = [
  ['openEdf', (source) => openEdf(source as never)],
  ['readHeader', (source) => readHeader(source as never)],
  [
    'readRecordBytes',
    async (source) => {
      const recording = await openEdf(byteSource(FILE));
      return readRecordBytes(source as never, recording.header, { start: 0, count: 1 });
    },
  ],
  ['inspectEdf', (source) => inspectEdf(source as never)],
  ['cachedSource', (source) => cachedSource(source as never)],
];

describe.each(CALLS)('%s, given fileSource(path) unawaited', (_name, call) => {
  it('no longer answers with the call the reader just made', async () => {
    const thrown = await refusal(() => call(pendingSource()));
    expect(thrown.message).not.toContain('fileSource(path) from "edfcore/node" for a file');
  });

  it('names the pending Promise and the one adapter that is async', async () => {
    const thrown = await refusal(() => call(pendingSource()));
    expect(thrown.message).toContain('that is a pending Promise');
    expect(thrown.message).toContain('fileSource(path) from "edfcore/node" is async');
    expect(thrown.message).toContain('needs awaiting');
  });

  it('says which adapters do not need it', async () => {
    const thrown = await refusal(() => call(pendingSource()));
    expect(thrown.message).toContain('byteSource, blobSource and httpSource are not');
  });

  it('stays an EdfSourceError with the fields a handler branches on', async () => {
    const thrown = await refusal(() => call(pendingSource()));
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect((thrown as EdfSourceError).offset).toBe(0);
    expect((thrown as EdfSourceError).requestedLength).toBe(0);
  });

  it('keeps the sentence saying what a ByteSource is', async () => {
    const thrown = await refusal(() => call(pendingSource()));
    expect(thrown.message).toContain('an object with a byteLength and a read()');
  });
});

describe('the adapter the message names', () => {
  it('really is the async one, and the others really are not', () => {
    const opened = fileSource('/nonexistent/recording.edf');
    expect(typeof (opened as { then?: unknown }).then).toBe('function');
    void opened.catch(() => undefined);
    // Synchronous: each returns a source, not a Promise for one.
    expect(typeof (byteSource(FILE) as { then?: unknown }).then).not.toBe('function');
    expect(typeof (cachedSource(byteSource(FILE)) as { then?: unknown }).then).not.toBe('function');
  });

  it('works once awaited, which is what the advice asks for', async () => {
    // Through byteSource, since the point is the keyword rather than the filesystem.
    const recording = await openEdf(byteSource(FILE));
    expect(recording.header.signals).toHaveLength(2);
  });
});

describe('every other wrong argument keeps its adapter', () => {
  it.each([
    ['bytes', FILE, 'wrap them with byteSource(bytes)'],
    ['a path', '/tmp/a.edf', 'that looks like a path'],
    ['an empty object', {}, 'use byteSource(bytes) for bytes in memory'],
  ])('refuses %s the way it always did', async (_shape, given, advice) => {
    const thrown = await refusal(() => readHeader(given as never));
    expect(thrown.message).toContain(advice);
    expect(thrown.message).not.toContain('pending Promise');
  });

  it('keeps the 0.6.222 refusal naming recording.source', async () => {
    const recording = await openEdf(byteSource(FILE));
    const thrown = await refusal(() => readHeader(recording as never));
    expect(thrown.message).toContain('that is a recording');
    expect(thrown.message).toContain('recording.source');
  });
});
