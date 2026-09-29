/**
 * `fileSource('')`, and the sentence Node answered it with.
 *
 * `ENOENT: no such file or directory, open ''` is a plain `Error`: no `Next:` clause, not an
 * `EdfSourceError`, so `isEdfError` says false and a caller's file-or-bug branch takes the wrong arm.
 * It is also not true in the way it reads. "No such file or directory" describes a lookup that
 * failed; there was never a name to look up.
 *
 * Both guards above this one exist because Node's own error "names a path nobody meant" — the EDF
 * header's bytes rendered as a filename, or a URL turned into a relative path. This is the case where
 * it names no path at all, which is the one a reader can do least with.
 *
 * It is the shape a shell and an argv produce, which is why it earns a sentence rather than an
 * `ENOENT`. `edfcore "$FILE"` with the variable unset, `process.argv[2]` on a bare invocation, and an
 * empty form field all arrive here as the empty string; a config value trimmed to nothing arrives as
 * whitespace. 0.6.246 and 0.6.255 closed both halves of this for `--limit` — a blank value reads as
 * zero rather than as the default, and a missing one printed the word `undefined`.
 *
 * Only blank. Every other path that does not exist keeps Node's `ENOENT`, because that error names
 * the path, and the path is the most useful thing anyone can say about it.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { fileSource } from '../../src/node.js';

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

describe('a blank path', () => {
  it.each([
    ['empty', ''],
    ['a single space', ' '],
    ['a tab', '\t'],
    ['a newline', '\n'],
  ])('is refused as naming no file, when %s', async (_shape, path) => {
    const thrown = await refusal(() => fileSource(path));
    expect(thrown.message).toContain('names no file');
  });

  it('is an EdfSourceError, so isEdfError says true', async () => {
    const thrown = await refusal(() => fileSource(''));
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ offset: 0, requestedLength: 0 });
  });

  it('does not claim a lookup failed, because none was made', async () => {
    const thrown = await refusal(() => fileSource(''));
    expect(thrown.message).not.toContain('no such file or directory');
    expect(thrown.message).not.toContain('ENOENT');
  });

  it('names the routes a blank path arrives by, and where to look', async () => {
    const thrown = await refusal(() => fileSource(''));
    expect(thrown.message).toContain('unset shell variable');
    expect(thrown.message).toContain('argv');
    expect(thrown.message).toContain('check the expression that produced it');
  });

  it('tells an empty path from one of only whitespace', async () => {
    expect((await refusal(() => fileSource(''))).message).toContain('an empty path');
    expect((await refusal(() => fileSource('   '))).message).toContain('a path of only whitespace');
  });
});

describe('every other path that does not exist', () => {
  it('keeps Node’s ENOENT, which names it', async () => {
    const thrown = await refusal(() => fileSource('/no/such/recording.edf'));
    expect(thrown.message).toContain('/no/such/recording.edf');
    expect(thrown.message).toContain('ENOENT');
  });

  it('including one that is only whitespace in the middle', async () => {
    const thrown = await refusal(() => fileSource('/tmp/a b.edf'));
    expect(thrown.message).toContain('ENOENT');
  });
});

describe('the guards above it', () => {
  it('keep their own sentences, and still run first', async () => {
    expect((await refusal(() => fileSource(new Uint8Array(8) as never))).message).toContain(
      'needs a path',
    );
    expect((await refusal(() => fileSource('http://example.invalid/x.edf'))).message).toContain(
      'is a http address',
    );
  });
});

describe('a path that is real', () => {
  it('still opens, and closing it is still the caller’s', async () => {
    const source = await fileSource(__filename);
    try {
      expect(source.byteLength).toBeGreaterThan(0);
    } finally {
      await source.close();
    }
  });
});
