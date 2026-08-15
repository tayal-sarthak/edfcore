/**
 * The header's number grammar, which is not JavaScript's.
 *
 * `Number('  12  ')` is 12, `Number('')` is 0 and `Number('0x10')` is 16 — every one of which
 * would accept a field the format does not allow, and the last two silently. These cases pin the
 * stricter grammar and the failure contract that goes with it: a rejected field says so rather
 * than resolving to a plausible number nobody asked for.
 */

import { describe, expect, it } from 'vitest';

import {
  type EdfNumberParse,
  parseEdfInteger,
  parseEdfNumber,
} from '../../../src/bytes/numbers.js';

/** Pure-ASCII source: control characters are built from their code points, never typed. */
const NUL = String.fromCharCode(0x00);
const TAB = String.fromCharCode(0x09);

type Problem = EdfNumberParse['problem'];

interface Case {
  /** Names the behaviour the row pins, not the input. */
  readonly name: string;
  readonly raw: string;
  readonly problem: Problem;
  /** Present only when the field is expected to parse. */
  readonly value?: number;
}

/**
 * Every assertion a row makes. `ok` is derived from `problem` rather than stated: the two can
 * never disagree, which is the invariant `'none'`/`'not-left-justified'` vs the rest encodes.
 */
function check(actual: EdfNumberParse, expected: Case): void {
  const shouldParse = expected.problem === 'none' || expected.problem === 'not-left-justified';

  expect([expected.raw, actual.problem]).toEqual([expected.raw, expected.problem]);
  expect([expected.raw, actual.ok]).toEqual([expected.raw, shouldParse]);
  // The field exactly as it was read, padding included - the diagnostic quotes it verbatim.
  expect(actual.raw).toBe(expected.raw);

  if (shouldParse) {
    expect([expected.raw, actual.value]).toEqual([expected.raw, expected.value]);
  } else {
    // ok:false ALWAYS carries NaN, so a caller that ignores the flag fails loudly instead of
    // quietly recording a plausible 0.
    expect([expected.raw, Number.isNaN(actual.value)]).toEqual([expected.raw, true]);
  }
}

/**
 * Rows both grammars must agree on. The integer grammar is a strict subset of the number
 * grammar, so everything here is either legal in both or junk in both.
 */
const SHARED: readonly Case[] = [
  {
    name: 'accepts a left-justified field, which is what the spec mandates',
    raw: '256',
    problem: 'none',
    value: 256,
  },
  {
    name: 'accepts trailing space padding as conformant, since EDF pads on the right',
    raw: '256     ',
    problem: 'none',
    value: 256,
  },
  {
    name: 'returns the value of a right-justified field and flags the layout, not the value',
    raw: '     256',
    problem: 'not-left-justified',
    value: 256,
  },
  {
    // Distinct from malformed: a blank field is a writer omitting a value, not corrupting
    // one, and several EDF fields are legally blank.
    name: 'reports an empty field as omitted rather than malformed',
    raw: '',
    problem: 'empty',
  },
  {
    name: 'reports an all-space field as omitted',
    raw: '        ',
    problem: 'empty',
  },
  {
    name: 'reports an all-NUL field as omitted, since NUL is padding too',
    raw: `${NUL}${NUL}${NUL}${NUL}${NUL}${NUL}${NUL}${NUL}`,
    problem: 'empty',
  },
  {
    // '0,5' is half. '1,024' is a thousand and twenty-four. They are INDISTINGUISHABLE: the
    // same substitution that turns '0,5' into 0.5 turns 1024 into 1.024. That is why edfcore
    // refuses both instead of guessing, and why COMMA_DECIMAL_SEPARATOR is always fatal
    // (DESIGN.md section 6). Both rows exist so neither can be "fixed" in isolation.
    name: "refuses '0,5' rather than guessing which side of the comma is fractional",
    raw: '0,5',
    problem: 'comma-decimal',
  },
  {
    name: "refuses '1,024' - indistinguishable from '0,5', so guessing would turn 1024 into 1.024",
    raw: '1,024',
    problem: 'comma-decimal',
  },
  {
    // comma-decimal is reserved for fields that are otherwise numeric; 'a,b' is just junk,
    // and reporting it as a decimal-separator problem would misname the damage.
    name: "reports 'a,b' as malformed, not as a comma decimal",
    raw: 'a,b',
    problem: 'malformed',
  },
  {
    name: "reports ',' alone as malformed",
    raw: ',',
    problem: 'malformed',
  },
  {
    // The interface documents `problem` as single-valued and ordered by how much it matters:
    // a field that is both right-justified and comma-separated reports the one the caller
    // must refuse.
    name: 'reports comma-decimal ahead of not-left-justified when a field is both',
    raw: '   0,5  ',
    problem: 'comma-decimal',
  },
  {
    // Embedded whitespace reaches the grammar intact. Never 2048 (concatenating), never 20
    // (stopping at the space) - both would be confidently wrong file geometry.
    name: "refuses '20 48' rather than reading it as 2048 or as 20",
    raw: '20 48',
    problem: 'malformed',
  },
  {
    name: 'refuses digits split by an interior NUL',
    raw: `20${NUL}48`,
    problem: 'malformed',
  },
  {
    // Only 0x20 and 0x00 are padding, so a TAB is content and content must match the grammar.
    name: 'treats a TAB as content rather than padding, so the field is malformed',
    raw: `${TAB}256`,
    problem: 'malformed',
  },
  {
    name: 'flags NUL padding after the digits as non-conformant layout, keeping the value',
    raw: `256${NUL}${NUL}${NUL}${NUL}${NUL}`,
    problem: 'not-left-justified',
    value: 256,
  },
  {
    name: 'accepts a leading plus, which real writers emit',
    raw: '+22',
    problem: 'none',
    value: 22,
  },
  {
    name: 'accepts a negative value',
    raw: '-1',
    problem: 'none',
    value: -1,
  },
  {
    name: 'rejects a lone sign with no digits',
    raw: '+',
    problem: 'malformed',
  },
  {
    name: 'rejects a lone decimal point',
    raw: '.',
    problem: 'malformed',
  },
  {
    name: 'rejects a hexadecimal literal, which is not in the grammar',
    raw: '0x10',
    problem: 'malformed',
  },
  {
    // Number('Infinity') is Infinity, so only the grammar stops this from becoming a
    // believable file offset.
    name: "rejects 'Infinity' even though Number() would accept it",
    raw: 'Infinity',
    problem: 'malformed',
  },
  {
    name: "rejects 'NaN' rather than returning a NaN that claims ok",
    raw: 'NaN',
    problem: 'malformed',
  },
  {
    name: 'rejects an entirely alphabetic field',
    raw: 'abcdefgh',
    problem: 'malformed',
  },
  {
    name: 'rejects a thousands-separated integer written with underscores',
    raw: '1_024',
    problem: 'malformed',
  },
];

/** Rows for the fractional grammar only. */
const NUMBER_ONLY: readonly Case[] = [
  {
    name: 'accepts a bare leading point, which writers in the wild emit',
    raw: '.5',
    problem: 'none',
    value: 0.5,
  },
  {
    name: 'accepts a bare trailing point',
    raw: '5.',
    problem: 'none',
    value: 5,
  },
  {
    name: 'accepts an ordinary decimal',
    raw: '0.5',
    problem: 'none',
    value: 0.5,
  },
  {
    name: 'accepts an upper-case exponent',
    raw: '1E3',
    problem: 'none',
    value: 1000,
  },
  {
    name: 'accepts a lower-case exponent',
    raw: '1e3',
    problem: 'none',
    value: 1000,
  },
  {
    name: 'accepts a signed fractional exponent form',
    raw: '-1.23E-4',
    problem: 'none',
    value: -1.23e-4,
  },
  {
    name: 'accepts a negative physical minimum',
    raw: '-500.25',
    problem: 'none',
    value: -500.25,
  },
  {
    name: 'accepts an exponent field that is right-justified, flagging only the layout',
    raw: '  1E3   ',
    problem: 'not-left-justified',
    value: 1000,
  },
  {
    // Grammar passes, but Number() overflows to Infinity - and an infinite physical range
    // would poison every scaled sample.
    name: 'rejects an exponent that overflows to Infinity rather than returning Infinity',
    raw: '1e999',
    problem: 'malformed',
  },
  {
    name: 'rejects an exponent marker with no exponent digits',
    raw: '1.0E',
    problem: 'malformed',
  },
  {
    name: 'accepts a value written with a redundant fractional zero',
    raw: '256.0',
    problem: 'none',
    value: 256,
  },
];

/** Rows for the integer grammar only - every one of these fields sizes the file geometry. */
const INTEGER_ONLY: readonly Case[] = [
  {
    // Exponent forms are rejected deliberately: '1E3' in a geometry field is far likelier to
    // be corruption than a writer's idea of 1000, and accepting it would turn unreadable
    // bytes into a confidently wrong offset.
    name: "rejects '1E3', because a geometry field must not accept an exponent",
    raw: '1E3',
    problem: 'malformed',
  },
  {
    name: "rejects '256.0', because a geometry field must not accept a decimal point",
    raw: '256.0',
    problem: 'malformed',
  },
  {
    name: 'rejects a bare leading point',
    raw: '.5',
    problem: 'malformed',
  },
  {
    name: 'rejects a signed fractional exponent form',
    raw: '-1.23E-4',
    problem: 'malformed',
  },
  {
    name: 'accepts the maximum signal count',
    raw: '9999',
    problem: 'none',
    value: 9999,
  },
  {
    name: 'accepts the EDF digital minimum',
    raw: '-32768',
    problem: 'none',
    value: -32768,
  },
  {
    name: 'accepts the EDF digital maximum',
    raw: '32767',
    problem: 'none',
    value: 32767,
  },
  {
    name: 'accepts the BDF digital minimum',
    raw: '-8388608',
    problem: 'none',
    value: -8388608,
  },
  {
    name: 'accepts the BDF digital maximum',
    raw: '8388607',
    problem: 'none',
    value: 8388607,
  },
  {
    name: 'accepts -1, the unknown-record-count sentinel',
    raw: '-1',
    problem: 'none',
    value: -1,
  },
  {
    // Beyond 2^53 the digits no longer round-trip, so the parsed value would be a lie.
    name: 'rejects a digit string too long to be an exact float64 integer',
    raw: '99999999999999999999',
    problem: 'malformed',
  },
];

describe('parseEdfNumber and parseEdfInteger agree on', () => {
  for (const testCase of SHARED) {
    it(`${testCase.name} (parseEdfNumber)`, () => {
      check(parseEdfNumber(testCase.raw), testCase);
    });

    it(`${testCase.name} (parseEdfInteger)`, () => {
      check(parseEdfInteger(testCase.raw), testCase);
    });
  }
});

describe('parseEdfNumber', () => {
  for (const testCase of NUMBER_ONLY) {
    it(testCase.name, () => {
      check(parseEdfNumber(testCase.raw), testCase);
    });
  }
});

describe('parseEdfInteger', () => {
  for (const testCase of INTEGER_ONLY) {
    it(testCase.name, () => {
      check(parseEdfInteger(testCase.raw), testCase);
    });
  }
});

describe('the failure contract', () => {
  it('never returns a plausible number for a field it rejected', () => {
    // Spelled out for the two cases most likely to be "helpfully" recovered by a future
    // refactor: a comma decimal and an embedded space.
    const commaDecimal = parseEdfNumber('1,024');
    expect(commaDecimal.value).not.toBe(1024);
    expect(commaDecimal.value).not.toBe(1.024);
    expect(Number.isNaN(commaDecimal.value)).toBe(true);

    const embeddedSpace = parseEdfInteger('20 48');
    expect(embeddedSpace.value).not.toBe(2048);
    expect(embeddedSpace.value).not.toBe(20);
    expect(Number.isNaN(embeddedSpace.value)).toBe(true);
  });

  it('carries NaN on every ok:false result across the whole table', () => {
    const everyRow = [...SHARED, ...NUMBER_ONLY, ...INTEGER_ONLY];
    const parsed = [
      ...everyRow.map((testCase) => parseEdfNumber(testCase.raw)),
      ...everyRow.map((testCase) => parseEdfInteger(testCase.raw)),
    ];

    const violations = parsed.filter((result) => !result.ok && !Number.isNaN(result.value));

    expect(violations).toEqual([]);
  });

  it('never reports a problem outside the documented set', () => {
    const allowed: readonly Problem[] = [
      'none',
      'empty',
      'comma-decimal',
      'not-left-justified',
      'malformed',
    ];
    const everyRow = [...SHARED, ...NUMBER_ONLY, ...INTEGER_ONLY];

    for (const testCase of everyRow) {
      expect(allowed).toContain(parseEdfNumber(testCase.raw).problem);
      expect(allowed).toContain(parseEdfInteger(testCase.raw).problem);
    }
  });

  it("reports 'none' only when the field is exactly left-justified and space-padded", () => {
    expect(parseEdfInteger('256     ').problem).toBe('none');
    expect(parseEdfInteger(' 256    ').problem).toBe('not-left-justified');
    expect(parseEdfInteger(`256    ${NUL}`).problem).toBe('not-left-justified');
  });
});
