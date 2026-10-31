/**
 * A source, or a recording, passed to `parseHeader`.
 *
 * `parseHeader` checks its second argument first, so `parseHeader(source)` was told
 * "sourceByteLength must be a non-negative safe integer, received undefined" — a complaint about
 * the argument that was simply absent, for a mistake in the one that was present.
 */

import { describe, expect, it } from 'vitest';
import { byteSource, openEdf, parseHeader } from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

describe('parseHeader given something other than the header bytes', () => {
  it('sends a ByteSource to readHeader', () => {
    const source = byteSource(minimalEdf());
    for (const run of [
      () => parseHeader(source as never, undefined as never),
      () => parseHeader(source as never, source.byteLength),
    ]) {
      expect(run).toThrow('parseHeader(): the header bytes are a ByteSource');
      expect(run).toThrow('Next: pass the source to readHeader(source)');
      expect(run).not.toThrow('sourceByteLength');
    }
  });

  it('sends a recording to its own header', async () => {
    const recording = await openEdf(byteSource(minimalEdf()));
    expect(() => parseHeader(recording as never, undefined as never)).toThrow(
      'parseHeader(): that is a recording, which carries its header already parsed. Next: use ' +
        'recording.header.',
    );
  });

  it('still parses the bytes', () => {
    const bytes = minimalEdf();
    expect(parseHeader(bytes, bytes.byteLength).signals.length).toBeGreaterThan(0);
  });
});
