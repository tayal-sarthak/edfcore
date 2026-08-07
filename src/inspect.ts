/**
 * Header-only triage that does not throw.
 *
 * Layer 6. This is the path that has to work when every other path has failed, which makes it the
 * one place in edfcore where `try`/`catch` is the right tool rather than a way of losing
 * information. Everywhere else a malformed file throws or records a diagnostic; here a malformed
 * file becomes `ok: false` plus the diagnostic that would have been thrown, so a caller can
 * triage a directory of unknown files without wrapping each call.
 *
 * Two boundaries keep that promise honest:
 *
 * - Only an `EdfError` is converted. Anything else is a bug in edfcore and is rethrown, because
 *   swallowing it would turn "this file is broken" into a claim we cannot support.
 * - The reads happen OUTSIDE the catch, so a source-level failure — a dead socket, a file that
 *   vanished — still rejects. `inspectEdf` promises not to throw about CONTENT; it never promised
 *   to hide I/O.
 *
 * At most 128 KiB is read, which is the full header of a file with up to 511 signals. A header
 * larger than that is reported as such instead of being half-parsed.
 */

import { parseEdfInteger } from './bytes/numbers.js';
import { readAsciiField } from './bytes/view.js';
import { EDF_HEADER_BLOCK_BYTES, EDF_MAX_SIGNAL_COUNT, HEADER_FIELDS } from './constants.js';
import { createDiagnostic, DiagnosticSink } from './diagnostics/collector.js';
import { type EdfError, type EdfFormatError, isEdfError } from './errors.js';
import { parseHeader } from './header/parse.js';
import { detectVariant } from './header/variant.js';
import { assertExactRead } from './io/source.js';
import type { ByteSource, EdfDiagnostic, EdfInspection, EdfVariant, ReadOptions } from './types.js';

/** 128 KiB is exactly `256 * 512`, i.e. the whole header of a 511-signal file. */
const MAX_INSPECT_BYTES = 128 * 1024;

/**
 * A prefetch hint only: how many bytes the second read should ask for.
 *
 * Every judgement about this field belongs to `header/parse.ts`. Returning `undefined` here just
 * means we hand `parseHeader` the 256 bytes we have and let it report the real problem.
 */
function signalCountHint(fixedHeader: Uint8Array): number | undefined {
  if (fixedHeader.length < EDF_HEADER_BLOCK_BYTES) return undefined;
  const { offset, length } = HEADER_FIELDS.signalCount;
  const parse = parseEdfInteger(readAsciiField(fixedHeader, offset, length));
  if (!parse.ok || parse.value < 1 || parse.value > EDF_MAX_SIGNAL_COUNT) return undefined;
  return parse.value;
}

/**
 * The family and dialect, when the header could not be parsed as a whole.
 *
 * The version block and the reserved field are the first 8 and 44 bytes of the fixed header and
 * are readable long after everything else has stopped making sense, so a file whose signal count
 * is garbage can still be reported as BDF rather than as nothing at all.
 */
function variantHint(headerBytes: Uint8Array): EdfVariant | undefined {
  if (headerBytes.length < EDF_HEADER_BLOCK_BYTES) return undefined;
  try {
    return detectVariant(headerBytes, new DiagnosticSink()).variant;
  } catch {
    return undefined;
  }
}

/**
 * The error, as the diagnostic it was carrying.
 *
 * `EdfFormatError` already holds the diagnostic it was built from, which keeps the byte offset,
 * the raw bytes and the spec reference intact — reconstructing a diagnostic from the message
 * would lose exactly the evidence triage needs.
 */
function diagnosticOf(error: EdfError): EdfDiagnostic {
  // `edfErrorKind`, not `instanceof`: the latter is false across realms, and triage is exactly
  // where a worker or an iframe boundary is most likely to be in play.
  if (error.edfErrorKind === 'format') {
    const formatError = error as EdfFormatError;
    return (
      formatError.diagnostic ??
      createDiagnostic({ code: formatError.code, message: formatError.message })
    );
  }
  return createDiagnostic({
    // Not a format code: the header did not fail its grammar, some other rule refused it. The
    // code union is open precisely so a case like this does not have to borrow a wrong name.
    code: 'INSPECTION_FAILED',
    message:
      `the header could not be inspected: ${error.message} Next: this is not a statement about ` +
      'the file grammar — read the message above, which names what was refused.',
  });
}

function budgetDiagnostic(signalCount: number, headerByteLength: number): EdfDiagnostic {
  return createDiagnostic({
    code: 'HEADER_EXCEEDS_INSPECTION_BUDGET',
    message:
      `the header of a file declaring ${signalCount} signals is ${headerByteLength} bytes ` +
      `(256 * (${signalCount} + 1)), above the ${MAX_INSPECT_BYTES}-byte ceiling inspectEdf() ` +
      'reads, so it was not parsed. Rule: inspectEdf() is triage and is bounded by design. ' +
      'Next: call readHeader(source) or openEdf(source), which read the whole header however ' +
      'large it is.',
    field: 'signalCount',
    byteOffset: HEADER_FIELDS.signalCount.offset,
    byteLength: HEADER_FIELDS.signalCount.length,
    expected: `at most ${MAX_INSPECT_BYTES} header bytes`,
    actual: `${headerByteLength} header bytes`,
    specReference: 'EDF specification, header record bytes 252-255 (number of signals)',
  });
}

/**
 * Read at most 128 KiB and say what the file is.
 *
 * `ok` is true only when the header parsed AND carried no error-severity diagnostic — a signal
 * whose scale edfcore refuses is an error even though the header itself is readable, because
 * physical units are unavailable for it. Warnings leave `ok` true: the file is impolite, and what
 * it reports is still true.
 */
export async function inspectEdf(
  source: ByteSource,
  options?: ReadOptions,
): Promise<EdfInspection> {
  const byteLength = source.byteLength;
  const budget = Math.min(MAX_INSPECT_BYTES, byteLength);

  const firstLength = Math.min(EDF_HEADER_BLOCK_BYTES, budget);
  const fixedHeader = assertExactRead(await source.read(0, firstLength, options), 0, firstLength);
  let bytesRead = firstLength;
  let headerBytes = fixedHeader;
  let overBudget: EdfDiagnostic | undefined;

  const signalCount = signalCountHint(fixedHeader);
  if (signalCount !== undefined) {
    const headerByteLength = EDF_HEADER_BLOCK_BYTES * (signalCount + 1);
    if (headerByteLength > MAX_INSPECT_BYTES) {
      overBudget = budgetDiagnostic(signalCount, headerByteLength);
    }
    const wanted = Math.min(headerByteLength, budget);
    const remaining = wanted - firstLength;
    if (remaining > 0) {
      const rest = assertExactRead(
        await source.read(firstLength, remaining, options),
        firstLength,
        remaining,
      );
      bytesRead += remaining;
      const combined = new Uint8Array(wanted);
      combined.set(fixedHeader, 0);
      combined.set(rest, firstLength);
      headerBytes = combined;
    }
  }

  try {
    // Never strict: a triage call that threw on the first impolite field would be useless for
    // exactly the files it exists to describe.
    const header = parseHeader(headerBytes, byteLength);
    const diagnostics =
      overBudget === undefined ? header.diagnostics : [overBudget, ...header.diagnostics];
    return {
      ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
      variant: header.variant,
      header,
      byteLength,
      bytesRead,
      headerBytes,
      diagnostics: Object.freeze(diagnostics),
    };
  } catch (error) {
    if (!isEdfError(error)) throw error;
    const failure = diagnosticOf(error);
    // Everything the parse had ALREADY found, before the fatal. A header parse accumulates as it
    // goes and reaches its fatal checks last, so a file can carry a degenerate physical range, a
    // degenerate digital range and a duplicated label and still be stopped by "no annotations
    // signal" — which names none of them. Returning only the fatal made `diagnostics` one entry
    // where four were in hand, in the one call whose whole job is triaging unknown files, and
    // contradicted its own documented "everything found" (fixed in 0.3.18).
    const collected = error.edfErrorKind === 'format' ? (error as EdfFormatError).collected : [];
    return {
      ok: false,
      variant: variantHint(headerBytes),
      header: undefined,
      byteLength,
      bytesRead,
      headerBytes,
      // The fatal comes LAST, after what led up to it: it is the reason parsing stopped, and a
      // reader following the list downwards reaches it in the order the parse did.
      diagnostics: Object.freeze([
        ...(overBudget === undefined ? [] : [overBudget]),
        ...collected,
        failure,
      ]),
    };
  }
}
