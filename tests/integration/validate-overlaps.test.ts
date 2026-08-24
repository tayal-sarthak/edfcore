/**
 * The overlaps `validate.ts` says are deliberate, asserted on the function that has to carry them.
 *
 * Its docblock names two codes the parser already emits and states why they are re-checked here:
 * "so a validation report stands on its own instead of only making sense next to
 * `header.diagnostics`". Neither had ever been produced by `validateHeader` in a test. Both were
 * covered through `parseHeader`, which is the other copy — so deleting either function from
 * `validate.ts` left the suite green, and a report that silently stopped standing on its own is
 * the one failure the sentence exists to prevent.
 *
 * The list is read out of the docblock rather than written here. A third overlap added to that
 * sentence without a case below fails the first test, which is what stops the prose and the cover
 * drifting apart again — the same shape of drift 0.4.455 found in a test name.
 *
 * Each case asserts three things: the parser reports it, `validateHeader` reports it too, and the
 * two are distinguishable. The third matters because both copies use the same code, so a test that
 * matched on the code alone would pass on the parser's diagnostic and prove nothing about this
 * module.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfDiagnostic, EdfHeader } from '../../src/types.js';
import { validateHeader } from '../../src/validate.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const SOURCE = readFileSync(new URL('../../src/validate.ts', import.meta.url), 'utf8');

/** The codes named in "Some codes overlap with ones the parser already emits (`A`, `B`)". */
const CLAIMED: readonly string[] = (() => {
  const sentence = /overlap with ones the parser already emits \(([^)]*)\)/.exec(
    SOURCE.replace(/\n \* /g, ' '),
  );
  return [...(sentence?.[1] ?? '').matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(
    (match) => match[1] as string,
  );
})();

/** Exactly 61,440 bytes a record, which is what the specification recommends at most. */
const AT_THE_LIMIT = buildEdf({
  signals: [{ label: 'Fp1', samplesPerRecord: 30_720 }],
  recordCount: 1,
  raw: { startDate: '1.1.2020' },
});

/** Two bytes over it. */
const OVER_THE_LIMIT = buildEdf({
  signals: [{ label: 'Fp1', samplesPerRecord: 30_721 }],
  recordCount: 1,
  raw: { startDate: '1.1.2020' },
});

/** EDF+ with a patient field that is not the four-subfield grammar. */
const BAD_PATIENT = minimalEdfPlus({ patientId: 'Haagse Harry, 1951' });

function headerOf(bytes: Uint8Array): EdfHeader {
  return parseHeader(bytes, bytes.byteLength);
}

const codes = (diagnostics: readonly EdfDiagnostic[]): readonly string[] =>
  diagnostics.map((one) => one.code);

interface Overlap {
  readonly code: string;
  readonly bytes: Uint8Array;
  /** A phrase only the parser's copy of the message contains. */
  readonly parserOnly: string;
}

const OVERLAPS: readonly Overlap[] = [
  {
    code: 'RECORD_SIZE_ABOVE_RECOMMENDED',
    bytes: OVER_THE_LIMIT,
    // The parser spells the arithmetic out: "(2 bytes per sample x 30721 samples)".
    parserOnly: 'bytes per sample x',
  },
  {
    code: 'PATIENT_ID_NONCONFORMANT',
    bytes: BAD_PATIENT,
    parserOnly: 'local patient identification (80 bytes at offset',
  },
];

describe('the claim was read', () => {
  it('names the codes this file covers, and no others', () => {
    expect([...CLAIMED].sort()).toEqual(OVERLAPS.map((one) => one.code).sort());
  });
});

describe.each(OVERLAPS)('$code', (overlap) => {
  it('is reported by the parser, which is what makes it an overlap', () => {
    expect(codes(headerOf(overlap.bytes).diagnostics)).toContain(overlap.code);
  });

  it('is reported by validateHeader as well, from its own check', () => {
    const reported = validateHeader(headerOf(overlap.bytes)).filter(
      (one) => one.code === overlap.code,
    );
    expect(reported).toHaveLength(1);
    // Not the parser's sentence. Both copies carry the same code, so this is the only thing that
    // says which function produced the diagnostic under test.
    expect(reported[0]?.message).not.toContain(overlap.parserOnly);
  });

  it('carries the field and the severity a consumer branches on', () => {
    const [reported] = validateHeader(headerOf(overlap.bytes)).filter(
      (one) => one.code === overlap.code,
    );
    expect(reported?.severity).toBe('warning');
    expect(reported?.expected).toBeDefined();
    expect(reported?.actual).toBeDefined();
  });
});

describe('the record size the specification recommends', () => {
  it('is not itself above the recommendation', () => {
    // 61,440 exactly. Narrowing `<=` to `<` in either copy warns every file that sized its records
    // to the number the specification names, which is the one size a careful writer would choose.
    const header = headerOf(AT_THE_LIMIT);
    expect(header.recordByteLength).toBe(61_440);
    expect(codes(header.diagnostics)).not.toContain('RECORD_SIZE_ABOVE_RECOMMENDED');
    expect(codes(validateHeader(header))).not.toContain('RECORD_SIZE_ABOVE_RECOMMENDED');
  });

  it('is exceeded by two bytes more', () => {
    // Non-vacuity: the fixture above is one sample short of reporting, not silent for some other
    // reason.
    const header = headerOf(OVER_THE_LIMIT);
    expect(header.recordByteLength).toBe(61_442);
    expect(codes(validateHeader(header))).toContain('RECORD_SIZE_ABOVE_RECOMMENDED');
  });
});
