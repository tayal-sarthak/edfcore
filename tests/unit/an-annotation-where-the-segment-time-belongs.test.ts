/**
 * An annotation handed to `segmentAt` where its time belongs.
 *
 * "Which segment holds this event?" is asked with the event in hand, and the advice was to avoid
 * "dividing by a zero recordDurationSeconds" — about an argument nobody computed by dividing.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, segmentAt } from '../../src/record-index.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

it('points an annotation at onsetSecondsFromFirstRecord', async () => {
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
  const index = await buildRecordIndex(recording);
  const { annotations } = await readAnnotations(recording, { start: 0, count: 2 });
  const [event] = annotations;
  expect(() => segmentAt(index, event as never)).toThrow(
    'Next: that is an annotation — pass annotation.onsetSecondsFromFirstRecord.',
  );
});
