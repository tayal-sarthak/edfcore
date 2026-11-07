/**
 * A header handed to `formatValidationReport` where the report belongs.
 *
 * The refusal said "it has no `ok` and no `diagnostics` list", and a header has exactly such a
 * list — so half of the sentence was false about the argument it described.
 */

import { expect, it } from 'vitest';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { minimalEdf } from '../support/writer.js';

it('does not deny the diagnostics a header carries', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  expect(() => formatValidationReport(header as never)).toThrow(
    'that is not a validation report — it has no `ok` over its `diagnostics`. Next:',
  );
  expect(() => formatValidationReport({} as never)).toThrow(
    'it has no `ok` and no `diagnostics` list. Next:',
  );
});
