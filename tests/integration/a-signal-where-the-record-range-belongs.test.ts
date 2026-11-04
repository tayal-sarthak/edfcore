/**
 * A signal handed to `readAnnotations` where its record range belongs.
 *
 * Every other read takes a channel, so `readAnnotations(recording, annotationSignal)` is the shape a
 * caller who has just found the TAL channel writes. It was refused as
 * `records { start: undefined, count: undefined }` — a range nobody named — when what arrived was a
 * signal, in an argument that never chooses one.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

it('readAnnotations() names a signal passed as its record range', async () => {
  const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 3 })));
  const annotationSignal = recording.header.signals.find((s) => s.kind === 'annotations');
  await expect(readAnnotations(recording, annotationSignal as never)).rejects.toThrow(
    'that is a signal, not a record range: this argument chooses which records to read, not ' +
      'which channel. Next: pass a start and a count — start 0, count 3 for the whole file.',
  );
});
