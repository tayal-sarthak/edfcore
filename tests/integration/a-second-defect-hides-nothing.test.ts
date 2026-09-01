/**
 * A second defect never hides the first.
 *
 * Every diagnostic in this package has a test built on a file with exactly one thing wrong with
 * it, because that is how you show which defect produces which code. Real files are not like that.
 * A recording written by a vendor tool that got the reserved field wrong got the patient
 * identification wrong too, and a writer that miscounted its records usually miscounted its header
 * length as well — the defects come in families, because they come from one mistaken program.
 *
 * The header parse is a single pass over shared state: one sink collecting into one list, eleven
 * numbered steps whose order `header/parse.ts` pins deliberately, and several checks that read
 * fields other checks have already judged. That is exactly the shape in which one defect swallows
 * another — an early `return` taken on the first bad field, a `catch` that abandons the rest of a
 * block, a check skipped because the value it needed was already reported as unusable. The file
 * would still open, the report would still look complete, and a caller fixing what they were told
 * about would find the next defect only on the next run.
 *
 * `parse.test.ts` asks the neighbouring question and stops short of this one: which FATAL a
 * multiply-broken file reports, where the answer is one error and the order decides it. Here
 * nothing is fatal, every defect is collected, and the answer has to be all of them.
 *
 * So each of seven independent corruptions is applied alone, to establish which code it owns, then
 * in all twenty-one pairs, and finally all seven at once. Every code has to survive every
 * combination.
 *
 * Six of the seven are independent in the FILE — different fields, none of which the format
 * derives from another — so a code going missing there is edfcore losing it rather than the file
 * no longer deserving it.
 *
 * The seventh is not, and finding that out is half of what this file is worth. A reserved field
 * that is not a recognised marker makes the file plain EDF rather than EDF+, and the patient and
 * recording identification grammars are EDF+ rules: `parse.ts` passes `edfPlus: variant.isPlus`
 * into both, so on a file that no longer claims EDF+ they are not checked and their two codes
 * correctly disappear. That is not masking, it is the file no longer deserving them — but it is
 * worth pinning, because the visible effect is that one wrong five-byte field silently stops the
 * identification from being examined at all, and nothing in the report says so.
 */

import { describe, expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { setHeaderField, setSignalField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

/** One data signal and one annotation signal, so `setSignalField` addresses two blocks. */
const SIGNAL_COUNT = 2;

function wellFormed(): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label: 'EEG Fp1', samplesPerRecord: 8 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
  });
}

interface Defect {
  readonly what: string;
  readonly code: string;
  /** True when the code is an EDF+ rule, and so does not apply once the file stops claiming EDF+. */
  readonly edfPlusOnly?: true;
  readonly apply: (bytes: Uint8Array) => Uint8Array;
}

const DEFECTS: readonly Defect[] = [
  {
    what: 'a reserved field that is not a recognised marker',
    code: 'NONSTANDARD_RESERVED_FIELD',
    apply: (bytes) => setHeaderField(bytes, 'reserved', 'ZZZZZ'),
  },
  {
    what: 'a patient identification that is not four subfields',
    code: 'PATIENT_ID_NONCONFORMANT',
    edfPlusOnly: true,
    apply: (bytes) => setHeaderField(bytes, 'patientId', 'not four subfields'),
  },
  {
    what: 'a recording identification with no Startdate',
    code: 'RECORDING_ID_NONCONFORMANT',
    edfPlusOnly: true,
    apply: (bytes) => setHeaderField(bytes, 'recordingId', 'no Startdate here'),
  },
  {
    what: 'a start time that is not a time',
    code: 'STARTTIME_UNPARSEABLE',
    apply: (bytes) => setHeaderField(bytes, 'startTime', 'zz.zz.zz'),
  },
  {
    what: 'a digital maximum wider than 16 bits',
    code: 'DIGITAL_RANGE_EXCEEDS_FORMAT',
    apply: (bytes) => setSignalField(bytes, SIGNAL_COUNT, 0, 'digitalMaximum', '99999'),
  },
  {
    what: 'a header length that is not the header',
    code: 'HEADER_SIZE_MISMATCH',
    apply: (bytes) => setHeaderField(bytes, 'headerByteLength', '999'),
  },
  {
    what: 'a record count the file cannot hold',
    code: 'TRUNCATED_FILE',
    apply: (bytes) => setHeaderField(bytes, 'recordCount', '9'),
  },
];

/** The one defect that changes which RULES apply, rather than only whether a rule is met. */
const DROPS_EDF_PLUS = 'NONSTANDARD_RESERVED_FIELD';

/** What a set of defects should produce: each one's code, less the EDF+ rules that stop applying. */
function expected(defects: readonly Defect[]): readonly string[] {
  const plain = defects.some((defect) => defect.code === DROPS_EDF_PLUS);
  return defects
    .filter((defect) => !(plain && defect.edfPlusOnly === true))
    .map((defect) => defect.code);
}

async function codesFor(defects: readonly Defect[]): Promise<readonly string[]> {
  let bytes = wellFormed();
  for (const defect of defects) bytes = defect.apply(bytes);
  const report = await inspectEdf(byteSource(bytes));
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

const CLEAN = await codesFor([]);

describe('each defect owns a code on its own', () => {
  it('does not already report any of them for the file with nothing wrong', () => {
    // Without this the pairs below would pass on a fixture that reports everything anyway.
    expect(CLEAN.filter((code) => DEFECTS.some((defect) => defect.code === code))).toEqual([]);
  });

  for (const defect of DEFECTS) {
    it(`reports ${defect.code} for ${defect.what}`, async () => {
      expect(await codesFor([defect])).toContain(defect.code);
    });
  }
});

describe('and every pair reports both', () => {
  const pairs: Array<readonly [Defect, Defect]> = [];
  for (let first = 0; first < DEFECTS.length; first += 1) {
    for (let second = first + 1; second < DEFECTS.length; second += 1) {
      pairs.push([DEFECTS[first] as Defect, DEFECTS[second] as Defect]);
    }
  }

  it('is every unordered pair of the seven, which is twenty-one of them', () => {
    expect(pairs).toHaveLength(21);
  });

  for (const [first, second] of pairs) {
    const both = [first, second];
    const want = expected(both);
    const title =
      want.length === 2
        ? `keeps ${first.code} and ${second.code} together`
        : `drops ${second.code} with ${first.code}, because the file stopped being EDF+`;

    it(title, async () => {
      const codes = await codesFor(both);
      for (const code of want) expect(codes).toContain(code);
      for (const defect of both) {
        if (want.includes(defect.code)) continue;
        expect(codes).not.toContain(defect.code);
      }
    });
  }

  it('gives the same answer in the other order, so the check order is not the reason', async () => {
    for (const [first, second] of pairs) {
      const codes = await codesFor([second, first]);
      for (const code of expected([first, second])) {
        expect(codes, `${second.code} then ${first.code}`).toContain(code);
      }
    }
  });

  it('has exactly two pairs where a rule stops applying, and they are the two EDF+ ones', () => {
    const dropped = pairs.filter(([first, second]) => expected([first, second]).length < 2);
    expect(dropped.map(([, second]) => second.code).sort()).toEqual([
      'PATIENT_ID_NONCONFORMANT',
      'RECORDING_ID_NONCONFORMANT',
    ]);
  });
});

describe('and all seven at once', () => {
  it('reports every code that still applies, which is the report a real broken file needs', async () => {
    const codes = await codesFor(DEFECTS);
    const want = expected(DEFECTS);
    expect(want).toHaveLength(DEFECTS.length - 2);
    expect(want.filter((code) => !codes.includes(code))).toEqual([]);
  });

  it('drops the two EDF+ identification rules and nothing else', async () => {
    const codes = await codesFor(DEFECTS);
    expect(codes).not.toContain('PATIENT_ID_NONCONFORMANT');
    expect(codes).not.toContain('RECORDING_ID_NONCONFORMANT');
    // Fixing the reserved field alone brings both back, which is what makes it the CAUSE rather
    // than a coincidence of ordering.
    const withoutReserved = DEFECTS.filter((defect) => defect.code !== DROPS_EDF_PLUS);
    const recovered = await codesFor(withoutReserved);
    expect(recovered).toContain('PATIENT_ID_NONCONFORMANT');
    expect(recovered).toContain('RECORDING_ID_NONCONFORMANT');
  });

  it('still opens rather than refusing, because none of the seven is fatal', async () => {
    let bytes = wellFormed();
    for (const defect of DEFECTS) bytes = defect.apply(bytes);
    const report = await inspectEdf(byteSource(bytes));
    // A caller with a file this broken gets a header and a list, not an exception — which is what
    // makes the completeness of the list the thing that matters.
    expect(report.header).toBeDefined();
    expect(report.diagnostics.length).toBeGreaterThanOrEqual(DEFECTS.length - 2);
  });
});
