/**
 * The open recording, handed to the four calls that take the source it was opened from.
 *
 * `assertByteSource` answers a wrong first argument with the adapter that would have fixed it —
 * `byteSource(bytes)` for bytes, `fileSource(path)` for a path, `blobSource(file)` for a File — and
 * falls back to listing all four. A recording is the one shape that list has nothing for: no
 * adapter turns one into a `ByteSource`, because it already holds the one it was opened from, on
 * `.source`. So the reader least in need of an adapter got four of them, for bytes, a path, a File
 * and a URL they do not have.
 *
 * `inspectEdf(source)` is where they meet it. It is the one call in the convenience layer whose
 * first argument is a source, and it sits in the barrel beside `readWindow`, `readRecords`,
 * `readAnnotations`, `readEnvelope` and `readTriggers` — every one of which takes the recording.
 * `readRecordBytes(recording.source, recording.header, records)` is the other route: the idiom
 * `physical-values.md` and `reading-signals.md` both write out, reached by leaving `.source` off
 * the argument that needs it while keeping `.header` on the one beside it.
 *
 * 0.6.90 named the mirror of this — "that is a header, not a recording — a recording also carries
 * the source, the timeline and the index" — because every primitive takes the header and the shape
 * is easy to reach for. This is the same confusion pointed the other way, and it is the direction
 * the package answered with a list.
 *
 * Only the `Next:` clause changes. It stays an `EdfSourceError` carrying `offset` and
 * `requestedLength`, and every other wrong argument keeps the adapter it always had.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

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

const CALLS: ReadonlyArray<readonly [string, (recording: EdfRecording) => unknown]> = [
  ['inspectEdf', (recording) => inspectEdf(recording as never)],
  ['openEdf', (recording) => openEdf(recording as never)],
  ['readHeader', (recording) => readHeader(recording as never)],
  [
    'readRecordBytes',
    (recording) => readRecordBytes(recording as never, recording.header, { start: 0, count: 1 }),
  ],
];

describe.each(CALLS)('%s, given the recording rather than its source', (_name, call) => {
  it('names the field it is carried on', async () => {
    const thrown = await refusal(async () => call(await opened()));
    expect(thrown.message).toContain('that is a recording');
    expect(thrown.message).toContain('recording.source');
  });

  it('no longer offers four adapters to a reader who needs none', async () => {
    const thrown = await refusal(async () => call(await opened()));
    expect(thrown.message).not.toContain('byteSource(bytes) for bytes in memory');
    expect(thrown.message).not.toContain('blobSource(file) for a File');
    expect(thrown.message).not.toContain('httpSource(url) for a URL');
  });

  it('stays an EdfSourceError with the fields a handler branches on', async () => {
    const thrown = await refusal(async () => call(await opened()));
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect((thrown as EdfSourceError).offset).toBe(0);
    expect((thrown as EdfSourceError).requestedLength).toBe(0);
  });

  it('keeps the sentence saying what a ByteSource is', async () => {
    const thrown = await refusal(async () => call(await opened()));
    expect(thrown.message).toContain('an object with a byteLength and a read()');
  });
});

describe('the source the message names', () => {
  it('is the one the recording was opened from, and it still reads', async () => {
    const recording = await opened();
    const inspection = await inspectEdf(recording.source);
    expect(inspection.header?.signals.length).toBe(2);
  });
});

describe('every other wrong argument keeps the adapter it had', () => {
  it.each([
    ['bytes', FILE, 'wrap them with byteSource(bytes)'],
    ['an ArrayBuffer', new ArrayBuffer(8), 'wrap them with byteSource(bytes)'],
    ['a path', '/tmp/a.edf', 'that looks like a path'],
    [
      'a Blob',
      { size: 4, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) },
      'that looks like a Blob or a File',
    ],
    ['an empty object', {}, 'use byteSource(bytes) for bytes in memory'],
    ['a header alone', { signals: [] }, 'use byteSource(bytes) for bytes in memory'],
  ])('refuses %s the way it always did', async (_shape, given, advice) => {
    const thrown = await refusal(() => readHeader(given as never));
    expect(thrown.message).toContain(advice);
    expect(thrown.message).not.toContain('that is a recording');
  });

  it('does not mistake a source that merely wraps another for a recording', async () => {
    const inner = byteSource(FILE);
    const thrown = await refusal(() => readHeader({ source: inner } as never));
    expect(thrown.message).toContain('use byteSource(bytes) for bytes in memory');
  });
});
