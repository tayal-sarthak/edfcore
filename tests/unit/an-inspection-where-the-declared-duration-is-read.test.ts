/**
 * An inspection handed to `declaredDurationSeconds`.
 *
 * How long a file says it is belongs to triage — it is one of the first things a header-only
 * pass reports — so `declaredDurationSeconds(inspection)` is what follows `inspectEdf`. It was
 * told to pass `recording.header`, which a caller who only triaged the file never opened.
 */

import { expect, it } from 'vitest';
import { declaredDurationSeconds } from '../../src/header/lookup.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

it('declaredDurationSeconds() points an inspection at inspection.header', async () => {
  const inspection = await inspectEdf(byteSource(minimalEdf()));
  expect(() => declaredDurationSeconds(inspection as never)).toThrow(
    'declaredDurationSeconds(): that is an inspection, not a header. Next: pass inspection.header',
  );
  expect(() => declaredDurationSeconds(inspection.header as never)).not.toThrow();
});
