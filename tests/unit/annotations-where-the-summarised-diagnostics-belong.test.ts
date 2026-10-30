/**
 * The annotations handed to `summarizeDiagnostics`.
 *
 * The refusal explained that "a row of a by-code summary counts a code rather than being one" —
 * about an annotation, which is not a summary row. Annotations have their own counter.
 */

import { expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

it('names an annotation as the element', async () => {
  const recording = await openEdf(
    byteSource(
      minimalEdfPlus({
        recordCount: 2,
        annotationSignals: [
          { samplesPerRecord: 40, tals: (r) => [{ onset: r + 0.5, texts: ['A'] }] },
        ],
      }),
    ),
  );
  const { annotations } = await readAnnotations(recording, { start: 0, count: 2 });
  expect(() => summarizeDiagnostics(annotations as never)).toThrow(
    'summarizeDiagnostics(): the value at 0 is an annotation, not a diagnostic. Next: count ' +
      'those with countAnnotationsByText()',
  );
});
