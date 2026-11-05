/**
 * `header.signals` handed to `validateHeader` in place of the header.
 *
 * Most of these checks are per signal, so the signals read as the thing being validated. It was
 * "that is not a header — it has no signals", about the one argument that is nothing but signals.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { validateHeader } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

it('names header.signals', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  expect(() => validateHeader(header.signals as never)).toThrow(
    'validateHeader(): that is header.signals, not the header',
  );
});
