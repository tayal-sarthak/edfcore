/**
 * `openEdf(bytes)` is the likeliest mistake anyone makes here, and it now says so.
 *
 * Every example in the documentation is `openEdf(byteSource(bytes))`, `openEdf(fileSource(path))`,
 * `openEdf(blobSource(file))`. The wrapper is the whole design — it is what lets one reader serve a
 * `Uint8Array`, a file handle, a `Blob` and an HTTP URL without knowing which — and it is also one
 * more call than a reader expects, so leaving it out is what people do.
 *
 * Until 0.4.444 leaving it out produced `TypeError: source.read is not a function`, and passing
 * nothing produced a `TypeError` about a property of `undefined` from a different line. Neither
 * names edfcore, the adapter that was missing, or the one word that fixes it. `byteSource` itself
 * has refused a wrong argument by name since the beginning — "received Int8Array. Next: pass
 * `new Uint8Array(await blob.arrayBuffer())`…" — and this is the same courtesy one call earlier,
 * where more people meet it.
 *
 * The advice is chosen by shape, because the right adapter differs and a list of four is a list a
 * reader has to work through. Bytes get `byteSource`; a string is almost always a path, and the
 * one for that lives in a different entry point, which is worth saying; anything with a `size` and
 * an `arrayBuffer` is a `Blob` or a `File` from a picker.
 *
 * The check is structural — a `read` function and a numeric `byteLength` — because `ByteSource` is
 * an interface `api-sources.md` documents implementing. A caller's own adapter is a `ByteSource`
 * whether or not it inherits from anything, and rejecting one would be worse than the `TypeError`
 * this replaces.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const BYTES = minimalEdfPlus({ recordCount: 2, recordDurationSeconds: 1 });

type Entry = (source: unknown) => Promise<unknown>;

const ENTRIES: ReadonlyMap<string, Entry> = new Map<string, Entry>([
  ['openEdf', (source) => openEdf(source as ByteSource)],
  ['inspectEdf', (source) => inspectEdf(source as ByteSource)],
]);

const refusalOf = (entry: Entry, source: unknown): Promise<EdfSourceError | undefined> =>
  entry(source).then(
    () => undefined,
    (thrown: unknown) => thrown as EdfSourceError,
  );

describe.each([...ENTRIES.entries()])('%s', (_name, entry) => {
  it.each([
    ['the bytes themselves', BYTES, 'Uint8Array'],
    ['an ArrayBuffer', BYTES.buffer, 'ArrayBuffer'],
    ['nothing at all', undefined, 'nothing'],
    ['null', null, 'null'],
    ['a path', '/data/night.edf', 'string'],
    ['an object that is not one', {}, 'Object'],
    ['an object with only half the shape', { byteLength: 10 }, 'Object'],
    // A `read` with no length is the other half, and the more tempting one to write: without a
    // `byteLength` nothing can be range-checked, so every read would be a request into the dark.
    [
      'an object with a read and no length',
      { read: () => Promise.resolve(new Uint8Array()) },
      'Object',
    ],
  ])('refuses %s, naming what arrived', async (_what, source, named) => {
    const failure = await refusalOf(entry, source);
    expect(failure, 'the call accepted something that is not a source').toBeDefined();
    expect(failure).toBeInstanceOf(EdfSourceError);
    expect(failure?.message).toContain(`received ${named}`);
    // Not the TypeError this replaced.
    expect(failure?.message).not.toContain('is not a function');
    expect(failure?.message).not.toContain('Cannot read properties');
    expect(failure?.message).toContain('Next:');
  });

  it('sends bytes to byteSource, which is the one word that was missing', async () => {
    expect((await refusalOf(entry, BYTES))?.message).toContain('byteSource(bytes)');
  });

  it('sends a path to the entry point that has fileSource in it', async () => {
    const message = (await refusalOf(entry, '/data/night.edf'))?.message ?? '';
    expect(message).toContain('looks like a path');
    // Naming the subpath matters: `fileSource` is not on the main entry point.
    expect(message).toContain('edfcore/node');
  });

  it('sends a Blob to blobSource', async () => {
    const blob = { size: 8, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
    const message = (await refusalOf(entry, blob))?.message ?? '';
    expect(message).toContain('Blob or a File');
    expect(message).toContain('blobSource(file)');
  });

  it('lists every adapter when it cannot tell what arrived', async () => {
    const message = (await refusalOf(entry, {}))?.message ?? '';
    for (const adapter of ['byteSource', 'fileSource', 'blobSource', 'httpSource']) {
      expect(message, `${adapter} is not offered`).toContain(adapter);
    }
  });

  it('accepts what it is supposed to', async () => {
    await expect(entry(byteSource(BYTES))).resolves.toBeDefined();
  });

  it('accepts a source a caller wrote themselves', async () => {
    // Structural, because `api-sources.md` documents implementing this interface. A hand-written
    // adapter is a ByteSource whether or not it inherits from anything.
    const mine: ByteSource = {
      byteLength: BYTES.byteLength,
      read: (offset, length) => Promise.resolve(BYTES.subarray(offset, offset + length)),
    };
    await expect(entry(mine)).resolves.toBeDefined();
  });
});
