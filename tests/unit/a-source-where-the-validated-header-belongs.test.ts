/**
 * A ByteSource handed to `validateHeader`.
 *
 * The header-only validation is the cheap look a caller takes before opening anything, so the
 * object in hand is often the source itself. It was told to pass `recording.header` — the one
 * object this check exists to avoid building — rather than the header `readHeader` reads.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { validateHeader } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

it('validateHeader() points a source at readHeader(source)', async () => {
  const source = byteSource(minimalEdf());
  expect(() => validateHeader(source as never)).toThrow(
    'validateHeader(): that is a ByteSource, which the header is read from rather than one. ' +
      'Next: pass `await readHeader(source)`.',
  );
  const header = await readHeader(source);
  expect(() => validateHeader(header)).not.toThrow();
});
