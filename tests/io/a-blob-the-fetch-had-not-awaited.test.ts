/**
 * `blobSource(response.blob())`, sent to an `<input type="file">`.
 *
 * `assertByteSource` has named this keyword since 0.6.264 and gives the rule: "`fileSource(path)`
 * from "edfcore/node" and `httpSource(url)` are both async, so both need awaiting; byteSource,
 * blobSource and cachedSource do not". That is about the ADAPTER. Its ARGUMENT is a different
 * question, and for this adapter the answer is the opposite: almost every way a browser hands over
 * a Blob is async.
 *
 *     await fetch(url).then((r) => r.blob())        // Response.blob()
 *     await (await showOpenFilePicker())[0].getFile()  // FileSystemFileHandle.getFile()
 *     await (await navigator.clipboard.read())[0].getType('application/octet-stream')
 *
 * Only an `<input type="file">` and a drop event give you one outright — and those two were exactly
 * what the advice named. A reader who forgot the keyword on `r.blob()` was told to go and find a
 * file picker, which is the route they had deliberately not used.
 *
 * `describeValue` named the subject correctly ("a pending Promise") the whole time, so the sentence
 * read "received a pending Promise. Next: pass the File an <input type="file"> ... hands you" — the
 * right diagnosis followed by advice for a different program.
 *
 * The other arm is untouched: a number, a string or a plain object is not a Blob, and for those the
 * file-picker advice was always the useful thing to say (0.6.295).
 */

import { describe, expect, it } from 'vitest';
import { blobSource } from '../../src/io/blob.js';

const refusal = (value: unknown): string => {
  try {
    blobSource(value as never);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('a Blob the fetch had not awaited', () => {
  it('is what each of the three async routes really hands over', async () => {
    // `Response.blob()` — a Promise, not a Blob, and the commonest route of the three.
    const pending = new Response(new Uint8Array(8)).blob();
    expect(typeof (pending as { then?: unknown }).then).toBe('function');
    // And what it resolves to is what `blobSource` takes.
    const resolved = await pending;
    expect(blobSource(resolved).byteLength).toBe(8);
  });

  it('is told to await it, and the three calls that resolve to one are named', () => {
    const message = refusal(new Response(new Uint8Array(8)).blob());
    expect(message).toContain('received a pending Promise');
    expect(message).toMatch(/Next: await it/);
    expect(message).toContain('Response.blob()');
    expect(message).toContain('FileSystemFileHandle.getFile()');
    expect(message).toContain('ClipboardItem.getType()');
  });

  it('no longer sends them to the two synchronous routes they did not use', () => {
    const message = refusal(Promise.resolve(new Blob([new Uint8Array(4)])));
    // Those two are now named as the contrast rather than as the instruction.
    expect(message).toMatch(/only an <input type="file"> and a drop event give it to you outright/);
    expect(message).not.toMatch(/Next: pass the File an <input type="file">/);
  });

  it('keeps the file-picker advice for everything that is not a Promise', () => {
    for (const [what, value] of [
      ['undefined', undefined],
      ['a number', 8],
      ['a string', '/tmp/a.edf'],
      ['a plain object', { length: 8 }],
      ['a Uint8Array', new Uint8Array(8)],
    ] as ReadonlyArray<readonly [string, unknown]>) {
      const message = refusal(value);
      expect(message, what).toMatch(/Next: pass the File an <input type="file"> or a drop event/);
      expect(message, what).toContain('byteSource(bytes)');
      expect(message, what).not.toMatch(/Next: await it/);
    }
  });

  it('still says what it needs, in both arms', () => {
    for (const value of [Promise.resolve(new Blob([])), 8]) {
      const message = refusal(value);
      expect(message).toContain('blobSource() needs a Blob or a File');
      expect(message).toMatch(/Next:/);
    }
  });

  it('still accepts a real Blob and a real File', () => {
    expect(blobSource(new Blob([new Uint8Array(16)])).byteLength).toBe(16);
    expect(blobSource(new File([new Uint8Array(16)], 'a.edf')).byteLength).toBe(16);
  });
});
