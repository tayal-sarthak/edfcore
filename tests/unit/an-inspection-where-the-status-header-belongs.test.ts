/**
 * An inspection handed to `getStatusSignal`.
 *
 * Whether a BDF carries a Status channel is a triage question — it decides whether there are
 * triggers to read at all — so `getStatusSignal(inspection)` follows `inspectEdf`. It was told to
 * pass `recording.header`, which a caller who only triaged the file never opened.
 */

import { expect, it } from 'vitest';
import { getStatusSignal } from '../../src/biosemi.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

it('getStatusSignal() points an inspection at inspection.header', async () => {
  const inspection = await inspectEdf(byteSource(minimalEdf()));
  expect(() => getStatusSignal(inspection as never)).toThrow(
    'getStatusSignal(): that is an inspection, not a header. Next: pass inspection.header',
  );
  expect(getStatusSignal(inspection.header as never)).toBeUndefined();
});
