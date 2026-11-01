/**
 * A recording handed to `summarizeDiagnostics` where its diagnostics belong.
 *
 * The sibling of the `formatDiagnostics` refusal, with the same gap: it named `header.diagnostics`
 * to a caller holding the recording, whose array is at `recording.header.diagnostics`.
 */

import { expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

it('summarizeDiagnostics() points a recording at recording.header.diagnostics', async () => {
  const recording = await openEdf(byteSource(minimalEdf()));
  expect(() => summarizeDiagnostics(recording as never)).toThrow(
    'Next: pass header.diagnostics — that is a recording, so recording.header.diagnostics.',
  );
});

it('keeps the general advice for anything else that is not an array', async () => {
  const inspection = await inspectEdf(byteSource(minimalEdf()));
  expect(() => summarizeDiagnostics(inspection as never)).toThrow(
    'Next: pass header.diagnostics, or',
  );
});
