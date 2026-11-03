/**
 * What `validateHeader` returns, handed to `formatValidationReport`.
 *
 * The two are neighbours in `edfcore/validate`, and the header-only check is the cheap one, so its
 * list is a natural thing to hand the printer. It was told to pass the whole report from
 * `validateRecording` — a sweep of every record the caller had chosen not to run — and never
 * that the list it held already has a printer.
 */

import { expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { formatValidationReport, validateHeader } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

it('formatValidationReport() points a header check at formatDiagnostics()', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  expect(() => formatValidationReport(validateHeader(header) as never)).toThrow(
    'A list from validateHeader() has none: print it with formatDiagnostics() from "edfcore".',
  );
  expect(() => formatValidationReport(header as never)).not.toThrow('formatDiagnostics()');
});
