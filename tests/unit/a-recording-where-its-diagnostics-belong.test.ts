/**
 * A recording handed to `formatDiagnostics` where its diagnostics belong.
 *
 * The refusal sent everyone to `header.diagnostics`. A caller holding the recording that
 * `openEdf` resolved to has no `header` variable; the array is at `recording.header.diagnostics`.
 */

import { expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('formatDiagnostics() points a recording at recording.header.diagnostics', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  expect(() => formatDiagnostics(recording as never)).toThrow(
    'Next: pass header.diagnostics — that is a recording, so recording.header.diagnostics.',
  );
  expect(() => formatDiagnostics(recording.header as never)).toThrow(
    'Next: pass header.diagnostics',
  );
});

it('does not call an inspection, which also carries a header, a recording', async () => {
  const inspection = await inspectEdf(byteSource(minimalEdf()));
  expect(() => formatDiagnostics(inspection as never)).toThrow('Next: pass header.diagnostics, or');
});
