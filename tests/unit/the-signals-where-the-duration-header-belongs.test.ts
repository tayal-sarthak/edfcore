/**
 * `header.signals` handed to `declaredDurationSeconds` in place of the header.
 *
 * It was "that is not a header — it has no recordCount" — true, and silent about the argument being
 * the header's own signals, one field too far in.
 */

import { expect, it } from 'vitest';
import { declaredDurationSeconds } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { minimalEdf } from '../support/writer.js';

it('names header.signals', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  expect(() => declaredDurationSeconds(header.signals as never)).toThrow(
    'declaredDurationSeconds(): that is header.signals, not the header',
  );
});
