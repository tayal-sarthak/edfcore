/**
 * The bytes moved after the source was built.
 *
 * Two of the three bundled adapters are asked this already, because for them it is an ordinary
 * accident. `blobSource` takes its length from `blob.size` and `source-contract.test.ts` shrinks
 * the blob under it — "a `File` whose backing file changed on disk since the picker ran is the
 * real-world case". `fileHandleSource` gets the same treatment against a handle over a file that
 * turned out shorter, and answers with a message naming the file length and the size it was built
 * for.
 *
 * `byteSource` was never asked, and the reason is that until recently there was nothing to ask.
 * An `ArrayBuffer` was a fixed extent for its whole life: measure it once at construction and the
 * measurement stayed true. It is not fixed any more. `resize` changes the length in place, and
 * `transfer` — which `postMessage(bytes, [bytes.buffer])` performs — takes the bytes away
 * entirely. Both leave the caller holding a `Uint8Array` that looks exactly as it did.
 *
 * The adapter is the one documented as retaining nothing the caller does not already hold, which
 * is what makes it zero-copy and safe. That is still true. What it does not cover is the caller
 * changing what they hold, and the three outcomes are different from each other:
 *
 * - SHRINKING is caught, by the contract guard every read goes through. The read asks the view for
 *   bytes that are no longer there, gets fewer, and `assertExactRead` refuses with both numbers —
 *   the same refusal a caller's own short-reading `ByteSource` earns.
 * - TRANSFERRING is refused at construction, since 0.5.62. A detached view keeps its tag and
 *   reports a `byteLength` of 0, so a source over one would report `SOURCE_TOO_SMALL` about a file
 *   that is fine.
 * - GROWING is invisible, and that is the honest answer rather than a defect. `byteLength` is the
 *   extent the caller presented, EDF addresses everything by absolute offset inside it, and a
 *   source that silently grew would change what `header.recordCount` means for a file already
 *   open.
 *
 * The three adapters are listed from `io/` so a fourth fails this file until it says which of the
 * three it does.
 */

import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

/** The bundled adapters, read off `src/io/` rather than listed. */
const ADAPTERS = readdirSync(new URL('../../src/io/', import.meta.url))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.replace(/\.ts$/, ''))
  .sort();

/**
 * The two members ES2024 added to `ArrayBuffer`, declared here rather than by raising `lib`.
 *
 * `browser-floor.test.ts` pins ES2022 as the published floor and reads it straight out of
 * `config/tsconfig.build.json`, so raising the compiler to type a test would invalidate three
 * published compatibility claims at once. Nothing in `src/` uses either member; this file uses
 * them to make the caller's buffer change under a source, which is the whole subject.
 */
interface ResizableArrayBuffer extends ArrayBuffer {
  resize(byteLength: number): void;
}
type ResizableArrayBufferConstructor = new (
  byteLength: number,
  options: { readonly maxByteLength: number },
) => ResizableArrayBuffer;
const Resizable = ArrayBuffer as unknown as ResizableArrayBufferConstructor;

/** A recording in a buffer that can still change size under the source. */
function resizableRecording(): { view: Uint8Array; buffer: ResizableArrayBuffer } {
  const bytes = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });
  const buffer = new Resizable(bytes.byteLength, { maxByteLength: bytes.byteLength * 2 });
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return { view, buffer };
}

/** Transfers a buffer away, which is what handing bytes to a worker does to the sender. */
function transferAway(buffer: ArrayBuffer): void {
  structuredClone(buffer, { transfer: [buffer] });
}

async function refusal(run: () => unknown): Promise<EdfSourceError> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(EdfSourceError);
  return thrown as EdfSourceError;
}

describe('the adapters that already answer this', () => {
  it('are two of the three, and the third is the one below', () => {
    // `source.ts` is the shared guard and `read.ts` is the layer above; neither is an adapter.
    expect(ADAPTERS).toEqual(['blob', 'bytes', 'cached', 'http', 'read', 'source']);
  });
});

describe('a buffer that shrank under the source', () => {
  it('is caught by the contract guard, with both numbers on the refusal', async () => {
    const { view, buffer } = resizableRecording();
    const source = byteSource(view);
    const full = source.byteLength;
    expect(full).toBeGreaterThan(512);

    buffer.resize(128);

    const error = await refusal(() => source.read(0, 512));
    expect(error.offset).toBe(0);
    expect(error.requestedLength).toBe(512);
    expect(error.receivedLength).toBe(128);
    expect(error.edfErrorKind).toBe('source');
  });

  it('is caught mid-recording too, so an open file cannot go on reading a file that shrank', async () => {
    const { view, buffer } = resizableRecording();
    const source = byteSource(view);
    // The header is read first and succeeds, so the failure lands on the DATA read — where a
    // reader would otherwise decode whatever is left as if it were the records it asked for.
    const recording = await openEdf(source);
    expect(recording.header.recordCount).toBe(4);

    buffer.resize(recording.header.headerByteLength);

    const error = await refusal(() =>
      source.read(recording.header.headerByteLength, recording.header.recordByteLength),
    );
    expect(error.receivedLength).toBe(0);
  });

  it('reports the shrunk length, not the length the source was built for', async () => {
    const { view, buffer } = resizableRecording();
    const source = byteSource(view);
    const built = source.byteLength;

    buffer.resize(300);

    // `byteLength` is what the source was built with and does not move, so `assertReadRange`
    // still admits the request and the guard after it is what refuses.
    expect(source.byteLength).toBe(built);
    expect((await refusal(() => source.read(0, built))).receivedLength).toBe(300);
  });
});

describe('a buffer that was transferred away', () => {
  it('is refused at construction rather than becoming a zero-byte file', () => {
    const { view, buffer } = resizableRecording();
    transferAway(buffer);
    expect(view.byteLength).toBe(0);

    const error = (() => {
      try {
        byteSource(view);
        return undefined;
      } catch (thrown) {
        return thrown as EdfSourceError;
      }
    })();

    expect(error).toBeInstanceOf(EdfSourceError);
    expect(error?.message).toContain('detached');
    expect(error?.message).toContain('Next:');
  });

  it('is refused as a short read when it happens after the source was built', async () => {
    // Construction cannot catch this one: the source was built over a buffer that still had its
    // bytes, and the transfer happened later. `view.byteLength` follows the buffer, so the read
    // sees nothing and says so with the numbers — rather than letting `subarray` throw the bare
    // `TypeError` a detached buffer produces, which is outside the error model entirely.
    const { view, buffer } = resizableRecording();
    const source = byteSource(view);
    transferAway(buffer);

    const error = await refusal(() => source.read(0, 256));
    expect(error.offset).toBe(0);
    expect(error.requestedLength).toBe(256);
    expect(error.receivedLength).toBe(0);
    expect(error.edfErrorKind).toBe('source');
  });

  it('still answers a zero-length read, which asks for nothing and can have it', async () => {
    const { view, buffer } = resizableRecording();
    const source = byteSource(view);
    transferAway(buffer);

    expect((await source.read(0, 0)).byteLength).toBe(0);
  });
});

describe('a buffer that grew', () => {
  it('is not seen, and that is the answer rather than a defect', async () => {
    const bytes = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });
    const buffer = new Resizable(bytes.byteLength, { maxByteLength: bytes.byteLength + 4096 });
    new Uint8Array(buffer).set(bytes);
    const source = byteSource(new Uint8Array(buffer));
    const before = source.byteLength;

    buffer.resize(bytes.byteLength + 4096);

    // The extent the caller presented is the file. Growing it does not append records to a
    // recording that is already open, and reading past `byteLength` is still out of range.
    expect(source.byteLength).toBe(before);
    expect((await refusal(() => source.read(before, 16))).requestedLength).toBe(16);
    expect((await source.read(0, before)).byteLength).toBe(before);
  });
});
