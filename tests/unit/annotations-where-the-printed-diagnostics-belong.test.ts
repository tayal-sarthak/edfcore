/**
 * The annotations handed to `formatDiagnostics`.
 *
 * `readAnnotations` resolves to `{ annotations, diagnostics }`, and the two lists sit side by side
 * with a printer for each. Crossed, the element was "an object, which carries no message" — true,
 * and silent about the printer one export away that takes exactly what was passed.
 */

import { expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
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
  expect(() => formatDiagnostics(annotations as never)).toThrow(
    'formatDiagnostics(): the value at 0 is an annotation, which formatAnnotations() prints.',
  );
});
