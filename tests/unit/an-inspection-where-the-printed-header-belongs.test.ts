/**
 * An inspection handed to `formatHeader`.
 *
 * Triage, then print what it found, is the whole of a header-only tool — `inspectEdf` and then
 * `formatHeader(inspection)`. It was told to pass `recording.header`, which a caller who only
 * triaged the file never opened.
 */

import { expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

it('formatHeader() points an inspection at inspection.header', async () => {
  const inspection = await inspectEdf(byteSource(minimalEdf()));
  expect(() => formatHeader(inspection as never)).toThrow(
    'formatHeader(): that is an inspection, not a header. Next: pass inspection.header',
  );
  expect(() => formatHeader(inspection.header as never)).not.toThrow();
});
