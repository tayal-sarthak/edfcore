/**
 * An inspection handed to `readRecordBytes` as its header.
 *
 * The primitive reads records by the header's record size and nothing else, so a caller who has
 * only triaged a file can use it without opening a recording — and the inspection is what they
 * hold. It was sent to `recording.header`, an object they never built.
 */

import { expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { minimalEdf } from '../support/writer.js';

it('readRecordBytes() points an inspection at inspection.header', async () => {
  const source = byteSource(minimalEdf());
  const inspection = await inspectEdf(source);
  const records = { start: 0, count: 1 };
  await expect(readRecordBytes(source, inspection as never, records)).rejects.toThrow(
    'readRecordBytes(): that is an inspection, not a header. Next: pass inspection.header',
  );
  await expect(readRecordBytes(source, inspection.header as never, records)).resolves.toBeDefined();
});
