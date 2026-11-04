/**
 * An annotation handed to a time bound.
 *
 * Jumping to an event is the commonest way a window gets placed, and the annotation is the object
 * in hand. It was "an object", and the advice was to convert it with `Number(text)` or find "the
 * matching *Seconds field" — an annotation carries two, on different axes, and only one of them is
 * the axis a read measures from.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

it('readWindow() points an annotation at onsetSecondsFromFirstRecord', async () => {
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
  const selection = { signalIndices: [0], startSeconds: event as never, durationSeconds: 1 };
  await expect(readWindow(recording, selection)).rejects.toThrow(
    'startSeconds must be a number of seconds, and was given an annotation. Next: pass ' +
      'annotation.onsetSecondsFromFirstRecord',
  );
});
