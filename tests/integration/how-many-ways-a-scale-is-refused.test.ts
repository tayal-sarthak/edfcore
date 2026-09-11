/**
 * The number of conditions under which `buildScale` returns `undefined`, counted by driving them.
 *
 * `header/scale.ts` called itself "Sole owner of `EdfScale` construction and of the four
 * conditions" a signal gets no scale under. There are five. The fifth — a physical range whose
 * derived gain is not a usable float64 — arrived in 0.4.509, and `design-decisions.md`,
 * `physical-values.md` and `api-errors.md` have each called it "the fifth" ever since. The module
 * that owns them kept the old count (fixed in 0.6.72).
 *
 * It is the docblock a reader opens to find out when `signal.scale` can be `undefined`, which is
 * the whole reason that field is optional, so a count one short there is a reader who handles
 * four cases and is surprised by a file.
 *
 * Each condition is built and driven below rather than counted out of the source, so a sixth has
 * to be exercised here before this may grow.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { buildEdf, type SignalSpec } from '../support/writer.js';

const MODULE = readFileSync(new URL('../../src/header/scale.ts', import.meta.url), 'utf8');

/** One signal, written with whatever raw fields the condition needs. */
function headerFor(signal: SignalSpec) {
  const bytes = buildEdf({ recordCount: 2, recordDurationSeconds: 1, signals: [signal] });
  return parseHeader(bytes, bytes.length);
}

const base = { label: 'Fp1', samplesPerRecord: 4 } as const;

/** The five ways a signal ends up with no scale, each named by the code it reports. */
const CONDITIONS: ReadonlyArray<readonly [string, SignalSpec]> = [
  ['DEGENERATE_DIGITAL_RANGE', { ...base, raw: { digitalMinimum: '7', digitalMaximum: '7' } }],
  ['DEGENERATE_PHYSICAL_RANGE', { ...base, raw: { physicalMinimum: '5', physicalMaximum: '5' } }],
  ['INVERTED_DIGITAL_RANGE', { ...base, raw: { digitalMinimum: '100', digitalMaximum: '-100' } }],
  ['LOG_TRANSFORMED_CHANNEL', { ...base, physicalDimension: 'Filtered' }],
  [
    // The fifth: four finite fields whose quotient is not.
    'DEGENERATE_PHYSICAL_RANGE',
    { ...base, raw: { physicalMinimum: '-9.9E307', physicalMaximum: '9.9E307' } },
  ],
];

describe('the conditions that refuse a scale', () => {
  it.each(CONDITIONS)('leaves scale undefined and reports %s', (code, signal) => {
    const header = headerFor(signal);
    expect(header.signals[0]?.scale).toBeUndefined();
    expect(header.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });

  it('are five, and the fifth is not any of the first four', () => {
    expect(CONDITIONS).toHaveLength(5);
    const fifth = CONDITIONS[4]?.[1];
    if (fifth === undefined) throw new Error('the fifth condition is missing');
    const header = headerFor(fifth);
    const codes = header.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain('DEGENERATE_DIGITAL_RANGE');
    expect(codes).not.toContain('INVERTED_DIGITAL_RANGE');
    expect(codes).not.toContain('LOG_TRANSFORMED_CHANNEL');
    // It shares DEGENERATE_PHYSICAL_RANGE with the second, and says which one it is.
    const reported = header.diagnostics.find((d) => d.code === 'DEGENERATE_PHYSICAL_RANGE');
    expect(reported?.message).toContain('not a usable float64');
  });

  it('leave an ordinary signal with a scale, so the fixtures are doing the work', () => {
    expect(headerFor(base).signals[0]?.scale).toBeDefined();
  });
});

describe('the docblock that counts them', () => {
  it('no longer says four', () => {
    expect(MODULE).not.toContain('the four conditions under which a');
  });

  it('says five, which is what the three pages have said since 0.4.509', () => {
    expect(MODULE).toContain('the five conditions under which a');
  });
});
