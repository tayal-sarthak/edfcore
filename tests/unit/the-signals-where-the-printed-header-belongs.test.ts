/**
 * `header.signals` handed to `formatHeader` in place of the header.
 *
 * The summary is mostly a signal table, so the signals read as the thing being printed. It was
 * "that is not a header — it has no signals", about the one argument that is nothing but signals.
 */

import { expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { minimalEdf } from '../support/writer.js';

it('names header.signals', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  expect(() => formatHeader(header.signals as never)).toThrow(
    'formatHeader(): that is header.signals, not the header',
  );
});
