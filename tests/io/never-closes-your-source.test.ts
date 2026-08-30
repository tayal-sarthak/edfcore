/**
 * "edfcore never calls it for you."
 *
 * That is the whole of what `api-sources.md` says about `close?()`, and it is a lifetime contract:
 * a caller who opened a file handle, or a source wrapping a pooled connection, is entitled to
 * decide when it is released. A library that closed it on the caller's behalf — at the end of a
 * read, or on the way out of a failure — would be releasing a resource the caller may still be
 * using, and the failure it produces arrives later and somewhere else.
 *
 * Nothing checked it. `cache.test.ts` covers the other direction, that `cachedSource.close()`
 * forwards to the source it wraps, which is the case where a caller DID ask. The sentence on the
 * page is about every other case.
 *
 * Both halves are checked here. Every reading entry point that takes a source is driven over a spy
 * that records whether it was closed — on success, and on the two ways a read fails, since a
 * `finally` added for cleanup is exactly how this contract gets broken. And the `close` call sites
 * are enumerated out of `src/`, because a behavioural sweep can only cover the paths it thought to
 * drive: there are four, every one of them inside a `close()` implementation of a source edfcore
 * hands back, except `fileSource`'s cleanup of a handle that never reached a caller.
 *
 * What this does NOT check: that `cachedSource.close()` forwards, or what a closed cache does with
 * an in-flight read. Those are `cache.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { type FileHandleLike, fileHandleSource } from '../../src/node.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { validateRecording } from '../../src/validate.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 16 }],
});

const RECORDS = { start: 0, count: 2 } as const;

// ---------------------------------------------------------------------------
// Every entry point, on the way through
// ---------------------------------------------------------------------------

type Drive = (source: ReturnType<typeof spySource>) => Promise<unknown>;

const SUCCEEDS: ReadonlyArray<readonly [string, Drive]> = [
  ['readHeader', (source) => readHeader(source)],
  ['openEdf', (source) => openEdf(source)],
  ['inspectEdf', (source) => inspectEdf(source)],
  [
    'readRecordBytes',
    async (source) => {
      const recording = await openEdf(source);
      return readRecordBytes(recording.source, recording.header, RECORDS);
    },
  ],
  [
    'readRecords',
    async (source) => readRecords(await openEdf(source), { records: RECORDS, signalIndices: [0] }),
  ],
  [
    'readWindow',
    async (source) =>
      readWindow(await openEdf(source), {
        startSeconds: 0,
        durationSeconds: 2,
        signalIndices: [0],
      }),
  ],
  ['readAnnotations', async (source) => readAnnotations(await openEdf(source), RECORDS)],
  ['buildRecordIndex', async (source) => buildRecordIndex(await openEdf(source))],
  [
    'validateRecording',
    async (source) => validateRecording(await openEdf(source), { scanSamples: true }),
  ],
  [
    'streamRecords',
    async (source) => {
      const chunks = [];
      for await (const chunk of streamRecords(await openEdf(source), {
        startSeconds: 0,
        durationSeconds: 4,
        signalIndices: [0],
        chunkRecords: 1,
      })) {
        chunks.push(chunk);
      }
      return chunks;
    },
  ],
  ['cachedSource around it', async (source) => openEdf(cachedSource(source))],
];

describe('a source handed to edfcore', () => {
  it.each(SUCCEEDS)('is not closed by %s', async (_name, drive) => {
    const source = spySource(byteSource(BYTES));
    await drive(source);
    expect(source.reads.length).toBeGreaterThan(0);
    expect(source.closed).toBe(false);
  });
});

describe('and is not closed on the way out of a failure either', () => {
  it('when the file is not an EDF at all', async () => {
    const source = spySource(byteSource(new Uint8Array(2048)));
    await expect(openEdf(source)).rejects.toThrow();
    expect(source.closed).toBe(false);
  });

  it('when a read is refused before it is issued', async () => {
    const source = spySource(byteSource(BYTES));
    const recording = await openEdf(source);
    await expect(
      readRecordBytes(
        recording.source,
        recording.header,
        { start: 0, count: 2 },
        {
          maxMaterializeBytes: 1,
        },
      ),
    ).rejects.toThrow();
    expect(source.closed).toBe(false);
  });

  it('when a read names records the file does not have', async () => {
    const source = spySource(byteSource(BYTES));
    const recording = await openEdf(source);
    await expect(
      readRecords(recording, { records: { start: 99, count: 1 }, signalIndices: [0] }),
    ).rejects.toThrow();
    expect(source.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The call sites, read out of src/
// ---------------------------------------------------------------------------

describe('the close call sites', () => {
  function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
        continue;
      }
      if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
    }
    return into;
  }

  const src = new URL('../../src/', import.meta.url);
  const names = sourceFiles(src, '', []).sort();

  /** An actual invocation — `x.close()` or `x.close?.()` — never a declaration or a comment. */
  function invocations(text: string): readonly string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('*') && !line.startsWith('//'))
      .filter((line) => /\b\w+\.close(?:\?\.)?\(\)/.test(line));
  }

  it('found the tree, so a passing run is not a vacuous one', () => {
    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain('node.ts');
    expect(names).toContain('io/cached.ts');
  });

  it('are only in the two modules that own a source lifetime', () => {
    const found = names.filter(
      (name) => invocations(readFileSync(new URL(name, src), 'utf8')).length > 0,
    );
    expect(found).toEqual(['io/cached.ts', 'node.ts']);
  });

  it('are four, and three of them are inside a close() of edfcore’s own source', () => {
    const cached = readFileSync(new URL('io/cached.ts', src), 'utf8');
    const node = readFileSync(new URL('node.ts', src), 'utf8');
    expect(invocations(cached)).toEqual(['await source.close?.();', 'await source.close?.();']);
    expect(invocations(node)).toEqual([
      'await handle.close();',
      'await handle.close().catch(() => undefined);',
    ]);
  });

  it('leaves the fourth as the documented exception: a handle that never reached a caller', () => {
    const node = readFileSync(new URL('node.ts', src), 'utf8');
    expect(node).toContain('The handle is closed if anything goes wrong before it has an owner');
    // And that one is in `fileSource`, after the `try` that would have handed it over.
    const cleanup = node.indexOf('await handle.close().catch(() => undefined);');
    expect(node.lastIndexOf('export async function fileSource', cleanup)).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// What close() does when the caller does call it
// ---------------------------------------------------------------------------

describe('the caller’s own close', () => {
  function countingHandle(): { handle: FileHandleLike; closes: () => number } {
    let closes = 0;
    return {
      handle: {
        async read(buffer: Uint8Array, offset: number, length: number, position: number) {
          buffer.set(BYTES.subarray(position, position + length), offset);
          return { bytesRead: length };
        },
        async close() {
          closes += 1;
        },
      },
      closes: () => closes,
    };
  }

  it('closes the handle exactly once, and reading does not', async () => {
    const { handle, closes } = countingHandle();
    const source = fileHandleSource(handle, BYTES.byteLength);

    const recording = await openEdf(source);
    await readRecords(recording, { records: RECORDS, signalIndices: [0] });
    expect(closes()).toBe(0);

    await source.close?.();
    expect(closes()).toBe(1);
  });
});
