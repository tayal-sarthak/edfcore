/**
 * An ArrayBuffer handed to `toPhysical` where its samples belong.
 *
 * Transferring `chunkSignal.digital.buffer` to a worker is how a viewer keeps scaling off the main
 * thread, and the buffer is what arrives. It was "ArrayBuffer, which has no length" — true, and
 * silent about the one-line view that turns it back into the samples.
 */

import { expect, it } from 'vitest';
import { toPhysical } from '../../../src/decode/physical.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import { minimalEdf } from '../../support/writer.js';

it('names an ArrayBuffer and the view that reads it', async () => {
  const { header } = await openEdf(byteSource(minimalEdf()));
  const [signal] = header.signals;
  const buffer = new Int32Array([0, 1, 2]).buffer;
  expect(() => toPhysical(signal as never, buffer as never)).toThrow(
    'toPhysical(): the samples are an ArrayBuffer — the bytes under them, which new ' +
      'Int32Array(buffer) views as samples.',
  );
});
