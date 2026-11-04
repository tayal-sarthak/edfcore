/**
 * An annotation handed to `sampleAt` as its time.
 *
 * "Which sample is this event on" is the question `sampleAt` answers for a cursor placed on an
 * annotation, and the annotation is what the cursor holds. It was "an object" and told to pass a
 * time on the recording axis — which the annotation carries, on `onsetSecondsFromFirstRecord`.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import { minimalEdfPlus } from '../support/writer.js';

it('sampleAt() points an annotation at onsetSecondsFromFirstRecord', async () => {
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
  expect(() => sampleAt(recording, 0, event as never)).toThrow(
    'Next: that is an annotation — pass annotation.onsetSecondsFromFirstRecord.',
  );
  expect(() => sampleAt(recording, 0, Number.NaN)).toThrow(
    'Next: pass a time on the recording axis',
  );
});
