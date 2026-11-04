/**
 * An inspection handed to `buildTimeline` as its header.
 *
 * `buildTimeline(source, header)` is the step after triage for a caller who wants the timeline
 * without opening a recording, so the inspection is the object in hand. It was told it had no
 * signals and to pass what `readHeader(source)` resolves to — a second read of a header the
 * inspection already carries.
 */

import { expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildTimeline } from '../../src/record-index.js';
import { minimalEdf } from '../support/writer.js';

it('buildTimeline() points an inspection at inspection.header', async () => {
  const source = byteSource(minimalEdf());
  const inspection = await inspectEdf(source);
  await expect(buildTimeline(source, inspection as never)).rejects.toThrow(
    'buildTimeline(): that is an inspection, not a header. Next: pass inspection.header',
  );
  await expect(buildTimeline(source, inspection.header as never)).resolves.toBeDefined();
});
