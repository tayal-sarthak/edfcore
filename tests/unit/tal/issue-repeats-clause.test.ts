/**
 * "(N occurrences in this region; the first is described)", and when it must not appear.
 *
 * `parseTalRegion` collapses repeats of one defect into a single issue carrying a count, rather
 * than reporting a diagnostic per TAL — a region of a thousand malformed TALs is a thousand
 * allocations dressed up as diligence. `grammar.test.ts` pins the counter thoroughly: the key is
 * the defect kind, three differently-malformed onsets are one issue with `occurrences` 3, and two
 * different defects stay two issues.
 *
 * What nothing checked is the SENTENCE the counter turns into. `reportIssue` appends the clause
 * only when there is more than one, and relaxing that guard puts "(1 occurrences in this region;
 * the first is described)" on the ordinary case — ungrammatical, and worse, it tells a reader
 * looking at a single bad TAL that there are others they cannot see. That is the same defect
 * 0.4.421 fixed on the validate report's first line: a count rendered without asking whether it
 * needed rendering.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../../src/header/parse.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfDiagnostic } from '../../../src/types.js';
import { minimalEdfPlus } from '../../support/writer.js';

const MARK = 0x14;
const NUL = 0x00;
const bytes = (text: string): number[] => Array.from(text).map((char) => char.charCodeAt(0));

/** `+0 0x14 0x14 0x00` — the conforming timekeeping TAL every record needs. */
const TIMEKEEPING = [...bytes('+0'), MARK, MARK, NUL];

/** An onset that is not a signed number, which drops the TAL and logs one issue. */
const malformed = (onset: string): number[] => [...bytes(onset), MARK, ...bytes('x'), MARK, NUL];

/** Record 0's annotation region, rewritten to hold the timekeeping TAL and `bad` after it. */
function decodeWith(bad: readonly number[][]): readonly EdfDiagnostic[] {
  const file = minimalEdfPlus({
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 60, tals: () => [] }],
  });
  const header = parseHeader(file, file.byteLength);
  const index = header.annotationSignalIndices[0];
  if (index === undefined) throw new Error('fixture has no annotations channel');
  const signal = header.signals[index];
  if (signal === undefined) throw new Error('fixture has no annotations channel');

  const at = header.headerByteLength + signal.recordByteOffset;
  file.fill(0, at, at + signal.recordByteLength);
  file.set(Uint8Array.from([...TIMEKEEPING, ...bad.flat()]), at);

  const recordBytes = file.subarray(
    header.headerByteLength,
    header.headerByteLength + header.recordByteLength,
  );
  return decodeAnnotations(header, recordBytes, { start: 0, count: 1 }).diagnostics;
}

const malformedOf = (diagnostics: readonly EdfDiagnostic[]): EdfDiagnostic | undefined =>
  diagnostics.find((one) => one.code === 'TAL_MALFORMED');

describe('one bad TAL in a region', () => {
  it('is reported without a count of anything', () => {
    const reported = malformedOf(decodeWith([malformed('??')]));

    // The premise: this really is the collapsed-issue path, and it really did fire once.
    expect(reported).toBeDefined();
    expect(reported?.message).not.toContain('occurrences');
    expect(reported?.message).not.toContain('the first is described');
  });
});

describe('three of the same bad TAL', () => {
  it('are one diagnostic that says how many there were', () => {
    // Collapsed by defect kind, so three different malformed onsets are still one issue.
    const found = decodeWith([malformed('??'), malformed('!!'), malformed('##')]).filter(
      (one) => one.code === 'TAL_MALFORMED',
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('(3 occurrences in this region; the first is described)');
  });

  it('describe the first one, which is what the clause promises', () => {
    const reported = malformedOf(decodeWith([malformed('??'), malformed('!!'), malformed('##')]));
    // The bytes quoted are the first offender's, not the last one's.
    expect(reported?.message).toContain('??');
    expect(reported?.message).not.toContain('##');
  });
});

describe('two of the same bad TAL', () => {
  it('cross the threshold at two, not at three', () => {
    // The boundary the guard is written on. Without this, a check reading `> 2` would pass every
    // case above.
    const reported = malformedOf(decodeWith([malformed('??'), malformed('!!')]));
    expect(reported?.message).toContain('(2 occurrences in this region');
  });
});
