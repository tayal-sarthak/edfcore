/**
 * The source handed to the decoders where the bytes read from it belong.
 *
 * `readRecordBytes(source, header, records)` and `decodeDigital(header, recordBytes, …)` are written
 * one after the other, and skipping the first hands the decoder the source. It was "an object, not
 * a Uint8Array" — true, and silent about the one object a caller of these two holds that is not.
 */

import { expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readHeader } from '../../../src/io/read.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import { minimalEdf } from '../../support/writer.js';

it('names a ByteSource handed to either decoder', async () => {
  const source = byteSource(minimalEdf());
  const header = await readHeader(source);
  const records = { start: 0, count: 1 };
  const named = 'the record bytes are a ByteSource, which serves them rather than holding them';
  expect(() => decodeDigital(header, source as never, records, 0)).toThrow(
    `decodeDigital(): ${named}`,
  );
  expect(() => decodeAnnotations(header, source as never, records)).toThrow(
    `decodeAnnotations(): ${named}`,
  );
});
