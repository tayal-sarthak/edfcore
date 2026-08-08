/**
 * Every subpath can name the types in its own signatures.
 *
 * `edfcore/validate` and `edfcore/node` exist so a consumer can take one part of the package
 * without the rest. That only works if each subpath exports the types a caller has to WRITE:
 * `validateRecording(recording: EdfRecording, …)` is useless from `edfcore/validate` alone if
 * `EdfRecording` is not there, and `fileSource(path): Promise<ByteSource>` is useless from
 * `edfcore/node` alone if `ByteSource` is not.
 *
 * Both were missing until 0.3.44 — the parameter type of the validate subpath's headline function,
 * and the return type of both of the node subpath's functions — so a consumer had to reach into
 * the root entry to write a single annotation.
 *
 * This file compiles under `tsconfig.json`, which is what `npm run typecheck` runs, so a
 * regression is a build failure rather than a discovery. It imports ONLY from the subpaths on
 * purpose: adding a root import here would defeat the whole check.
 */

import { describe, expect, it } from 'vitest';
import type { ByteSource, ReadOptions } from '../../src/node.js';
import { type FileHandleLike, fileHandleSource } from '../../src/node.js';
import type {
  EdfHeader,
  EdfRecording,
  ValidateOptions,
  ValidationReport,
} from '../../src/validate.js';
import { formatValidationReport, validateHeader, validateRecording } from '../../src/validate.js';

// --- edfcore/validate ------------------------------------------------------
//
// Everything below sits inside a function that is never called: vitest collects `.test-d.ts`
// files and RUNS them as well as typechecking them, so a `declare const` used at module scope
// would blow up at runtime while proving nothing extra. The annotations are what is being
// checked, and they are checked by `tsc` either way.

export function validateSubpathIsSelfSufficient(
  recording: EdfRecording,
  header: EdfHeader,
  options: ValidateOptions,
  finished: ValidationReport,
): [Promise<ValidationReport>, readonly unknown[], string] {
  // Each annotation is written the way a consumer of the subpath alone would have to write it.
  const report: Promise<ValidationReport> = validateRecording(recording, options);
  const headerOnly: readonly unknown[] = validateHeader(header);
  const text: string = formatValidationReport(finished, { header });
  return [report, headerOnly, text];
}

// --- edfcore/node ----------------------------------------------------------

export function nodeSubpathIsSelfSufficient(
  handle: FileHandleLike,
  readOptions: ReadOptions,
): [ByteSource, Promise<Uint8Array>] {
  const source: ByteSource = fileHandleSource(handle, 1024);
  const bytes: Promise<Uint8Array> = source.read(0, 256, readOptions);
  return [source, bytes];
}

describe('subpath self-sufficiency', () => {
  it('is enforced by compilation, not by this assertion', () => {
    // `npm run typecheck` compiles this file. If a subpath stops exporting a type its own
    // signatures use, that command fails and this test never runs.
    expect(typeof validateSubpathIsSelfSufficient).toBe('function');
    expect(typeof nodeSubpathIsSelfSufficient).toBe('function');
  });
});
