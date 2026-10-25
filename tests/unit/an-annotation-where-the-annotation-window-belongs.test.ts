/**
 * An annotation handed to `filterAnnotationsByTime` as its window.
 *
 * "The events around this one" is written with the event in hand, and it was refused with
 * "window.startSeconds must be a finite number of seconds, but was undefined" and advice about a
 * selection built one field at a time — nothing about the onset an annotation carries instead.
 */

import { expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

it('names an annotation handed over as the window', async () => {
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
  expect(() => filterAnnotationsByTime(annotations, event as never)).toThrow(
    'filterAnnotationsByTime(): the window is an annotation, which has an onset rather than a ' +
      'startSeconds. Next: pass annotation.onsetSecondsFromFirstRecord as startSeconds',
  );
});
