/**
 * `header.signals` handed to `getStatusSignal` in place of the header.
 *
 * Finding the Status channel is a search of the signals, so the signals read as the thing to
 * search. It was "that is not a header — it has no signals", about the one argument that is
 * nothing but signals.
 */

import { expect, it } from 'vitest';
import { getStatusSignal } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { minimalEdf } from '../support/writer.js';

it('names header.signals', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  expect(() => getStatusSignal(header.signals as never)).toThrow(
    'getStatusSignal(): that is header.signals, not the header',
  );
});
