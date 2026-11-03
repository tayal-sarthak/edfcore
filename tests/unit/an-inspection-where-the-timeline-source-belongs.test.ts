/**
 * An inspection handed to `buildTimeline` as its source.
 *
 * The recording guard recognised anything with a `.header` object, and an inspection has one: it
 * was called a recording and told to pass `recording.source`, which an inspection does not carry
 * and a caller who only triaged the file never had.
 */

import { expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildTimeline } from '../../src/record-index.js';
import { minimalEdf } from '../support/writer.js';

it('buildTimeline() names an inspection rather than calling it a recording', async () => {
  const source = byteSource(minimalEdf());
  const inspection = await inspectEdf(source);
  const refusal = buildTimeline(inspection as never, inspection.header as never);
  await expect(refusal).rejects.toThrow('that is an inspection');
  await expect(refusal).rejects.not.toThrow('that is a recording');
});
