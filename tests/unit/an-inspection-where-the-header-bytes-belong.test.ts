/**
 * An inspection handed to `parseHeader`.
 *
 * The guard recognised anything with a `.header` object as a recording, and an inspection has one:
 * it was told to use `recording.header`, naming an object a caller who only triaged the file never
 * opened, when the parsed header was on the inspection it passed.
 */

import { expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

it('parseHeader() points an inspection at inspection.header', async () => {
  const bytes = minimalEdf();
  const inspection = await inspectEdf(byteSource(bytes));
  expect(() => parseHeader(inspection as never, bytes.byteLength)).toThrow(
    'parseHeader(): that is an inspection, which carries its header already parsed. Next: use ' +
      'inspection.header.',
  );
});
