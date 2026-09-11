/**
 * Where the two numbers in `samplesPerRecord * bytesPerSample` actually come from.
 *
 * `header/signals.ts` said "Both numbers come from this file and nowhere else", in the docblock
 * that teaches the record layout — the layout whose misreading it calls "the single most common
 * EDF bug". Only `samplesPerRecord` comes from there. `bytesPerSample` is decided in
 * `header/variant.ts`, from the version block at offset 0, and it is the entire difference
 * between a 2-byte EDF sample and a 3-byte BDF one (fixed in 0.6.60).
 *
 * A reader tracing "why is this record this many bytes?" was sent to one file when it takes two,
 * and to the one that cannot answer the half that changes with the format.
 *
 * The first test is the one that matters: the same signal fields, byte for byte, under the two
 * version blocks, give two different record sizes. Nothing in `signals.ts` decides that.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { buildEdf } from '../support/writer.js';

const ROOT = new URL('../../src/header/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, ROOT), 'utf8');

const SIGNALS = read('signals.ts');
const VARIANT = read('variant.ts');

/** The same channel geometry, written once as EDF and once as BDF. */
const geometry = { recordCount: 2, recordDurationSeconds: 1 } as const;
const signals = [{ label: 'Fp1', samplesPerRecord: 10 }];

const EDF = buildEdf({ ...geometry, format: 'EDF', signals });
const BDF = buildEdf({ ...geometry, format: 'BDF', signals });

describe('the record size the layout produces', () => {
  it('is the same samplesPerRecord under both formats', () => {
    const edf = parseHeader(EDF, EDF.length);
    const bdf = parseHeader(BDF, BDF.length);
    expect(edf.signals[0]?.samplesPerRecord).toBe(10);
    expect(bdf.signals[0]?.samplesPerRecord).toBe(10);
  });

  it('and a different bytesPerSample, which signals.ts does not decide', () => {
    const edf = parseHeader(EDF, EDF.length);
    const bdf = parseHeader(BDF, BDF.length);
    expect(edf.bytesPerSample).toBe(2);
    expect(bdf.bytesPerSample).toBe(3);
    expect(edf.recordByteLength).toBe(20);
    expect(bdf.recordByteLength).toBe(30);
  });
});

describe('the two files', () => {
  it('has variant.ts, not signals.ts, assigning bytesPerSample', () => {
    expect(VARIANT).toMatch(/bytesPerSample:\s*family === 'BDF'/);
    expect(SIGNALS).not.toMatch(/^\s*bytesPerSample:/m);
  });

  it('no longer claims signals.ts owns both numbers', () => {
    expect(SIGNALS).not.toContain('Both numbers come from this file and nowhere else');
  });

  it('names variant.ts as the other one', () => {
    expect(SIGNALS.slice(0, SIGNALS.indexOf('\n */'))).toContain('header/variant.ts');
  });
});
