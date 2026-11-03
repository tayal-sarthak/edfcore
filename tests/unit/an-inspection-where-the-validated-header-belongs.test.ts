/**
 * An inspection handed to `validateHeader`.
 *
 * Triage and a header-only validation are the two cheap looks at a file, and `validateRecording`
 * already names an inspection and sends it to `validateHeader(inspection.header)`. Handed the
 * inspection itself, `validateHeader` said only that it had no signals and sent the caller to
 * `recording.header` — an object they never opened.
 */

import { expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { validateHeader } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

it('validateHeader() points an inspection at inspection.header', async () => {
  const inspection = await inspectEdf(byteSource(minimalEdf()));
  expect(() => validateHeader(inspection as never)).toThrow(
    'validateHeader(): that is an inspection, not a header. Next: pass inspection.header',
  );
  expect(() => validateHeader(inspection.header as never)).not.toThrow();
});
