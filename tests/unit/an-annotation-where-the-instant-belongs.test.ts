/**
 * An annotation handed to `annotationsAt` where its instant belongs.
 *
 * An annotation carries a `durationSeconds`, so it was taken for a time window — "that is a time
 * window ... pass window.startSeconds" — and sent to a field it does not have. The conversion
 * below that guard already names an annotation and the field to pass.
 */

import { expect, it } from 'vitest';
import { annotationsAt } from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

it('names an annotation rather than calling it a time window', async () => {
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
  const [event] = annotations;
  expect(() => annotationsAt(annotations, event as never)).toThrow(
    'seconds must be a number of seconds, and was given an annotation. Next: pass ' +
      'annotation.onsetSecondsFromFirstRecord',
  );
});
