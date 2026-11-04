/**
 * An inspection handed to the two decoders as their header.
 *
 * `readRecordBytes` and the decoders beside it work from a header alone, which is what lets a
 * caller who has only triaged a file read samples without opening a recording. Handed the
 * inspection itself, `decodeDigital` and `decodeAnnotations` both sent the caller to
 * `recording.header` — an object that path never builds.
 */

import { expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { inspectEdf } from '../../../src/inspect.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import { minimalEdf } from '../../support/writer.js';

it('points an inspection at inspection.header in both decoders', async () => {
  const source = byteSource(minimalEdf());
  const inspection = await inspectEdf(source);
  const records = { start: 0, count: 1 };
  const bytes = await readRecordBytes(source, inspection.header as never, records);
  const expected = 'that is an inspection, not a header. Next: pass inspection.header';
  expect(() => decodeDigital(inspection as never, bytes, records, 0)).toThrow(
    `decodeDigital(): ${expected}`,
  );
  expect(() => decodeAnnotations(inspection as never, bytes, records)).toThrow(
    `decodeAnnotations(): ${expected}`,
  );
});
