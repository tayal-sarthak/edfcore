/**
 * The forgotten-await advice every source guard gives, and the adapter it said was not one.
 *
 * 0.6.222 added the branch so a pending Promise got "the one keyword that fixes it" rather than a
 * list of calls, and wrote the reason into it: "`fileSource(path)` is the only async adapter in the
 * package". It is not. `httpSource` is declared `async`, and its own docblock says why — "async
 * because it probes the server for range support and a length before returning".
 *
 * So the message named the shape correctly and then argued the reader out of the fix.
 * `openEdf(httpSource(url))` is the browser and remote quickstart with exactly the keyword missing
 * that this branch exists to name, and the clause after the naming told that reader `httpSource` is
 * among the adapters that are "not" the ones needing awaiting.
 *
 * Saying nothing would have been better. The list the branch replaced at least did not contradict
 * the mistake; this pointed at it and then denied it.
 *
 * Five published surfaces share the sentence — `openEdf`, `readHeader`, `readRecordBytes`,
 * `inspectEdf`, and `cachedSource`, which wraps a source — so all five said it.
 *
 * What this pins: the two async adapters are named together, the three synchronous ones are named
 * together, and no adapter appears on both sides. `cachedSource` joins the synchronous list because
 * it is one and was not mentioned at all.
 */

import { describe, expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { blobSource } from '../../src/io/blob.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { fileSource } from '../../src/node.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();

const refusal = async (call: () => unknown): Promise<string> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

/** A Promise standing in for `httpSource(url)` with the keyword left off. */
const pendingSource = (): unknown => Promise.resolve(byteSource(bytes));

describe('the adapters the advice names as needing a keyword', () => {
  it('are both of the async ones', async () => {
    const message = await refusal(() => openEdf(pendingSource() as never));
    expect(message).toContain('fileSource(path)');
    expect(message).toContain('httpSource(url)');
    expect(message).toContain('both need awaiting');
  });

  it('do not also appear in the list of ones that do not', async () => {
    const message = await refusal(() => openEdf(pendingSource() as never));
    const notNeeded = message.slice(message.indexOf('do not') - 60);
    expect(notNeeded).not.toContain('httpSource');
    expect(notNeeded).not.toContain('fileSource');
  });

  it('really are async, which is what the sentence now claims', async () => {
    expect(fileSource(__filename)).toBeInstanceOf(Promise);
    const probe = httpSource('https://example.invalid/x.edf', {
      byteLength: 8,
      fetch: (() =>
        Promise.resolve({
          ok: true,
          status: 206,
          headers: { get: () => 'bytes 0-0/8' },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
        })) as never,
    });
    expect(probe).toBeInstanceOf(Promise);
    await probe;
    await (await fileSource(__filename)).close();
  });
});

describe('the adapters it names as synchronous', () => {
  it('really are, so a reader is not sent to await one of them', () => {
    expect(byteSource(bytes)).not.toBeInstanceOf(Promise);
    expect(
      blobSource({ size: bytes.byteLength, slice: () => new Blob() } as never),
    ).not.toBeInstanceOf(Promise);
    expect(cachedSource(byteSource(bytes))).not.toBeInstanceOf(Promise);
  });

  it('include cachedSource, which the old sentence left out entirely', async () => {
    const message = await refusal(() => openEdf(pendingSource() as never));
    expect(message).toContain('cachedSource');
  });
});

describe('every surface that shares the sentence', () => {
  it('gives the corrected one', async () => {
    const header = await readHeader(byteSource(bytes));
    const calls: ReadonlyArray<readonly [string, () => unknown]> = [
      ['openEdf', () => openEdf(pendingSource() as never)],
      ['readHeader', () => readHeader(pendingSource() as never)],
      [
        'readRecordBytes',
        () => readRecordBytes(pendingSource() as never, header, { start: 0, count: 1 }),
      ],
      ['inspectEdf', () => inspectEdf(pendingSource() as never)],
      ['cachedSource', () => cachedSource(pendingSource() as never)],
    ];
    for (const [name, call] of calls) {
      const message = await refusal(call);
      expect(message, name).toContain('both need awaiting');
      expect(message, name).toContain('httpSource(url)');
    }
  });
});

describe('the shape, which was always named correctly', () => {
  it('still leads the sentence', async () => {
    expect(await refusal(() => openEdf(pendingSource() as never))).toContain(
      'that is a pending Promise',
    );
  });
});
