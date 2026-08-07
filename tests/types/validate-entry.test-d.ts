/**
 * `edfcore/validate` can be used without reaching into the universal entry.
 *
 * The subpath re-exports the shapes it produces so a consumer can name a `ValidationReport`. That
 * was incomplete: `validateHeader` TAKES an `EdfHeader` and RETURNS `EdfDiagnostic[]`, and
 * `FormatReportOptions.header` is an `EdfHeader`, so someone importing only this entry could call
 * every function in it and still not name the type of anything they passed or got back.
 *
 * A type-only file. It asserts by compiling: if a name below stops being exported from the
 * subpath, `npm run typecheck` fails here rather than in a consumer's project.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type {
  EdfDiagnostic,
  EdfDiagnosticCode,
  EdfHeader,
  EdfRecordIndex,
  EdfSeverity,
  EdfSignal,
  FormatReportOptions,
  ObservedSignalStats,
  RecordRange,
  ValidateOptions,
  ValidationReport,
} from '../../src/validate.js';
import { formatValidationReport, validateHeader, validateRecording } from '../../src/validate.js';

describe('the validate subpath is self-sufficient', () => {
  it('names every type its own signatures mention', () => {
    // The argument and the return of the one synchronous function in the entry.
    expectTypeOf(validateHeader).parameter(0).toEqualTypeOf<EdfHeader>();
    expectTypeOf(validateHeader).returns.toEqualTypeOf<readonly EdfDiagnostic[]>();

    // The option bag `formatValidationReport` takes, and the report both it and the sweep use.
    expectTypeOf(formatValidationReport).parameter(0).toEqualTypeOf<ValidationReport>();
    expectTypeOf<FormatReportOptions['header']>().toEqualTypeOf<EdfHeader | undefined>();
    expectTypeOf(validateRecording).returns.resolves.toEqualTypeOf<ValidationReport>();

    // And the shapes reachable from a report, so a consumer can destructure it fully.
    expectTypeOf<ValidationReport['signalStats']>().toEqualTypeOf<readonly ObservedSignalStats[]>();
    expectTypeOf<EdfDiagnostic['severity']>().toEqualTypeOf<EdfSeverity>();
    expectTypeOf<EdfDiagnostic['code']>().toEqualTypeOf<EdfDiagnosticCode>();
    expectTypeOf<EdfHeader['signals']>().toEqualTypeOf<readonly EdfSignal[]>();
    // The option that lets a caller reuse a scan, so conformance costs one traversal.
    expectTypeOf<ValidateOptions['index']>().toEqualTypeOf<EdfRecordIndex | undefined>();
    expectTypeOf<EdfRecordIndex['recordCount']>().toEqualTypeOf<number>();
    expectTypeOf<RecordRange['start']>().toEqualTypeOf<number>();
  });
});
