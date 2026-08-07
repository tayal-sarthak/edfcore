/**
 * Numerical parity with pyEDFlib, against values pyEDFlib produced.
 *
 * edfcore pins EDFlib's exact scaling expression — `bitValue * (offset + digital)`, in that order
 * — instead of the numerically better `physicalMinimum + (digital - digitalMinimum) * gain`. That
 * is deliberate and has exactly one justification: float64 bit-parity with EDFlib, pyEDFlib and
 * MNE. Every other test of it re-derives the same expression inside the test, which proves edfcore
 * agrees with itself and says nothing at all about the claim.
 *
 * This is the claim, executed. `scripts/golden/generate.py` writes these files with pyEDFlib's own
 * writer, reads them back with pyEDFlib, and records every physical sample as its exact IEEE-754
 * bit pattern. Nothing in `tests/corpus/golden/` was produced by edfcore, and the comparison is
 * `Object.is` per sample — a one-ULP difference fails, because a one-ULP difference is precisely
 * what the pinned expression exists to avoid.
 *
 * The bit patterns are stored as hex rather than as decimals so no argument about round-tripping a
 * float through JSON can arise. Python and JavaScript both round-trip a float64 through its
 * shortest decimal, so the decimals would in fact have been fine; the hex removes the question.
 *
 * Regenerating needs Python and pyEDFlib, so the goldens are committed and CI never runs it:
 *
 *     python3 -m venv .venv && .venv/bin/pip install pyedflib
 *     .venv/bin/python scripts/golden/generate.py
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';

interface GoldenSignal {
  readonly index: number;
  readonly label: string;
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
  readonly sampleCount: number;
  readonly digital: readonly number[];
  readonly physicalBits: readonly string[];
}

interface Golden {
  readonly file: string;
  readonly producer: string;
  readonly signals: readonly GoldenSignal[];
}

const CASES = [
  'edf-symmetric',
  'edf-asymmetric',
  'bdf-24bit',
  // physicalMinimum > physicalMaximum is a legal negative amplifier gain (EDF FAQ Q6). edfcore
  // never swaps the two, because a silent polarity flip is a clinically wrong result that looks
  // completely normal — so this case checks that edfcore and pyEDFlib agree about the SIGN.
  'edf-negative-gain',
  // The extreme bitValue ratios, where the pinned and textbook expressions diverge most coarsely.
  'edf-narrow-digital',
] as const;

function goldenDir(name: string): string {
  return fileURLToPath(new URL(`./golden/${name}`, import.meta.url));
}

/** The exact float64 those 16 hex digits denote. */
function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

function load(name: (typeof CASES)[number]): { golden: Golden; bytes: Uint8Array } {
  const golden = JSON.parse(readFileSync(goldenDir(`${name}.json`), 'utf8')) as Golden;
  const bytes = new Uint8Array(readFileSync(goldenDir(golden.file)));
  return { golden, bytes };
}

describe('the goldens are pyEDFlib output, not ours', () => {
  it.each(CASES)('%s names its producer and carries real samples', (name) => {
    // Without this the whole file could pass against an empty or self-produced fixture.
    const { golden, bytes } = load(name);
    expect(golden.producer).toMatch(/^pyedflib \d/);
    expect(golden.signals.length).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeGreaterThan(256);
    for (const signal of golden.signals) {
      expect(signal.physicalBits).toHaveLength(signal.sampleCount);
      expect(signal.digital).toHaveLength(signal.sampleCount);
      // A ramp across the whole declared range: both ends are present, so the affine map is
      // exercised at its extremes and not only near the middle.
      expect(Math.min(...signal.digital)).toBe(signal.digitalMinimum);
      expect(Math.max(...signal.digital)).toBe(signal.digitalMaximum);
    }
  });
});

describe('edfcore reads the digital samples pyEDFlib wrote', () => {
  it.each(CASES)('%s', async (name) => {
    const { golden, bytes } = load(name);
    const recording = await openEdf(byteSource(bytes));

    for (const expected of golden.signals) {
      const signal = recording.header.signals[expected.index];
      expect(signal?.label, `signal ${expected.index}`).toBe(expected.label);

      const [chunk] = await readWindow(recording, {
        signalIndices: [expected.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
      });
      const digital = chunk?.signals[0]?.digital;
      expect(digital, expected.label).toBeDefined();
      expect(Array.from(digital ?? [])).toEqual([...expected.digital]);
    }
  });
});

describe('edfcore reproduces pyEDFlib physical values bit for bit', () => {
  it.each(CASES)('%s', async (name) => {
    const { golden, bytes } = load(name);
    const recording = await openEdf(byteSource(bytes));

    for (const expected of golden.signals) {
      const signal = recording.header.signals[expected.index];
      if (signal === undefined) throw new Error(`no signal ${expected.index}`);

      const [chunk] = await readWindow(recording, {
        signalIndices: [expected.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
      });
      const digital = chunk?.signals[0]?.digital;
      if (digital === undefined) throw new Error(`no samples for ${expected.label}`);

      const physical = toPhysical(signal, digital);
      expect(physical.length, expected.label).toBe(expected.sampleCount);

      // Object.is, not toBeCloseTo. Bit-parity is the contract; a tolerance would pass for the
      // textbook expression too and this file would then be proving nothing.
      let mismatches = 0;
      let firstMismatch = '';
      for (let i = 0; i < expected.sampleCount; i += 1) {
        const want = fromBits(expected.physicalBits[i] as string);
        const got = physical[i] as number;
        if (!Object.is(got, want)) {
          mismatches += 1;
          if (firstMismatch === '') {
            firstMismatch = `sample ${i}: digital ${expected.digital[i]}, edfcore ${got}, pyEDFlib ${want}`;
          }
        }
      }
      expect(mismatches, `${expected.label}: ${firstMismatch}`).toBe(0);
    }
  });
});

describe('the parity is a real constraint, not an accident of these fixtures', () => {
  it('the textbook expression disagrees with pyEDFlib on the asymmetric file', async () => {
    // If the two forms agreed everywhere, the test above would pass whatever edfcore computed and
    // the pinning would be decoration. This asserts the goldens can tell them apart.
    const { golden, bytes } = load('edf-asymmetric');
    const recording = await openEdf(byteSource(bytes));
    const expected = golden.signals[0];
    const signal = recording.header.signals[expected?.index ?? 0];
    if (expected === undefined || signal === undefined) throw new Error('fixture missing');

    const gain =
      (signal.physicalMaximum - signal.physicalMinimum) /
      (signal.digitalMaximum - signal.digitalMinimum);

    let differing = 0;
    for (let i = 0; i < expected.sampleCount; i += 1) {
      const textbook =
        signal.physicalMinimum + ((expected.digital[i] as number) - signal.digitalMinimum) * gain;
      if (!Object.is(textbook, fromBits(expected.physicalBits[i] as string))) differing += 1;
    }

    // Not "some": a specific, large fraction, so a change that quietly makes them agree is visible.
    expect(differing).toBeGreaterThan(expected.sampleCount / 4);
  });
});

describe('the negative-gain file keeps its polarity', () => {
  it('decreases as the digital value increases, in edfcore and in pyEDFlib alike', async () => {
    // `physicalMinimum > physicalMaximum` is a legal negative amplifier gain. edfcore never swaps
    // the two fields, because a silent polarity flip is a clinically wrong result that looks
    // completely normal — the traces keep the right amplitude, frequency content and artifacts.
    // Bit-parity alone would not catch a swap that pyEDFlib also made, so the SHAPE is asserted
    // against the file's own declaration rather than against pyEDFlib.
    const { golden, bytes } = load('edf-negative-gain');
    const expected = golden.signals[0];
    if (expected === undefined) throw new Error('fixture missing');
    expect(expected.physicalMinimum).toBeGreaterThan(expected.physicalMaximum);

    const recording = await openEdf(byteSource(bytes));
    const signal = recording.header.signals[expected.index];
    if (signal === undefined) throw new Error('no signal');
    expect(signal.scale?.bitValue).toBeLessThan(0);

    const [chunk] = await readWindow(recording, {
      signalIndices: [expected.index],
      startSeconds: 0,
      durationSeconds: recording.timeline.spanSeconds,
    });
    const digital = chunk?.signals[0]?.digital;
    if (digital === undefined) throw new Error('no samples');
    const physical = toPhysical(signal, digital);

    // The fixture ramps digital from its minimum to its maximum, so physical must run the other
    // way — from the declared physicalMinimum end down to the physicalMaximum end.
    expect(physical[0] as number).toBeGreaterThan(physical[physical.length - 1] as number);
    for (let i = 1; i < physical.length; i += 1) {
      if ((digital[i] as number) > (digital[i - 1] as number)) {
        expect(physical[i] as number, `sample ${i}`).toBeLessThan(physical[i - 1] as number);
      }
    }
    // And pyEDFlib's own values run the same way, so neither library swapped the fields.
    const first = fromBits(expected.physicalBits[0] as string);
    const last = fromBits(expected.physicalBits[expected.sampleCount - 1] as string);
    expect(first).toBeGreaterThan(last);
  });
});
