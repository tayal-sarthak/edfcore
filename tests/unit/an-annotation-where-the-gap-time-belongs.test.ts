/**
 * An annotation handed to `gapAt` where its time belongs.
 *
 * "Was this event recorded across a gap?" is asked with the event in hand. It was "received an
 * object. Next: pass a number" — and an annotation carries two numbers of seconds, on two axes,
 * of which only one is the axis this index measures from.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt } from '../../src/record-index.js';
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
  expect(() => gapAt(index, event as never)).toThrow(
    'Next: that is an annotation — pass annotation.onsetSecondsFromFirstRecord.',
  );
});
