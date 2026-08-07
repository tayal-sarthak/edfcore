/**
 * Agreement with MNE — a second, independent reader.
 *
 * pyEDFlib and edfcore both descend from EDFlib's arithmetic, so parity between them shows edfcore
 * copied it correctly and not that the answer is right. MNE is a different implementation with a
 * different audience, which is why it is worth checking separately.
 *
 * THE CLAIM HERE IS WEAKER THAN THE pyEDFlib ONE, deliberately. MNE returns SI units: a microvolt
 * channel arrives in volts, having been divided by 1e6, and that division is lossy — multiplying
 * back does not land on the same float64. So this asserts a tight RELATIVE bound rather than
 * `Object.is`, and the bound is the unit conversion, not a disagreement about the sample.
 * Bit-parity is claimed for pyEDFlib alone; see `golden-values.test.ts`.
 *
 * Only channels MNE actually rescales are compared. It leaves a `degC` channel exactly as written,
 * so putting one through a 1e6 factor would be comparing an artefact of the test.
 *
 * Regenerating needs Python and MNE, so the goldens are committed and CI never runs it:
 *
 *     .venv/bin/pip install mne
 *     .venv/bin/python scripts/golden/generate-mne.py
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';

interface MneSignal {
  readonly index: number;
  readonly label: string;
  readonly unit: string;
  readonly toSiDivisor: number;
  readonly sampleCount: number;
  readonly siBits: readonly string[];
}

interface MneGolden {
  readonly file: string;
  readonly producer: string;
  readonly signals: readonly MneSignal[];
}

const CASES = [
  'edf-symmetric',
  'edf-asymmetric',
  'edf-negative-gain',
  'edf-narrow-digital',
] as const;

function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

function load(name: (typeof CASES)[number]): { golden: MneGolden; bytes: Uint8Array } {
  const dir = (file: string): string => fileURLToPath(new URL(`./golden/${file}`, import.meta.url));
  const golden = JSON.parse(readFileSync(dir(`${name}.mne.json`), 'utf8')) as MneGolden;
  return { golden, bytes: new Uint8Array(readFileSync(dir(golden.file))) };
}

/**
 * The bound, as a RELATIVE difference rather than an absolute one or an ULP count.
 *
 * ULP distance was the first instinct and is the wrong measure here. MNE reports volts, so a
 * microvolt sample arrives near 1e-6, and the same relative rounding spans far more representable
 * floats there than it does near 100. The quantity that stays constant across both magnitudes is
 * the relative difference, and that is what a lossy unit conversion actually produces.
 *
 * 1e-12 is roughly ten thousand times the float64 epsilon and roughly a hundred times the worst
 * value observed — loose enough not to be brittle, and still some ten orders of magnitude below
 * the quantisation step of any real recording, so a genuine disagreement could not hide under it.
 */
const MAX_RELATIVE_DIFFERENCE = 1e-12;

describe('the MNE goldens are MNE output', () => {
  it.each(CASES)('%s names its producer and carries samples', (name) => {
    const { golden, bytes } = load(name);
    expect(golden.producer).toMatch(/^mne \d/);
    expect(golden.signals.length).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeGreaterThan(256);
    for (const signal of golden.signals) {
      expect(signal.siBits).toHaveLength(signal.sampleCount);
      expect(signal.toSiDivisor).toBeGreaterThan(1);
    }
  });
});

describe('edfcore agrees with MNE to within its unit conversion', () => {
  it.each(CASES)('%s', async (name) => {
    const { golden, bytes } = load(name);
    const recording = await openEdf(byteSource(bytes));

    for (const expected of golden.signals) {
      const signal = recording.header.signals[expected.index];
      if (signal === undefined) throw new Error(`no signal ${expected.index}`);
      expect(signal.label).toBe(expected.label);

      const [chunk] = await readWindow(recording, {
        signalIndices: [expected.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
      });
      const digital = chunk?.signals[0]?.digital;
      if (digital === undefined) throw new Error(`no samples for ${expected.label}`);
      const physical = toPhysical(signal, digital);
      expect(physical.length).toBe(expected.sampleCount);

      let worst = 0;
      let worstAt = '';
      for (let i = 0; i < expected.sampleCount; i += 1) {
        // edfcore reports the file's own units; MNE reports SI. The conversion is MNE's, so it is
        // applied to edfcore's value rather than undone on MNE's.
        const mine = (physical[i] as number) / expected.toSiDivisor;
        const theirs = fromBits(expected.siBits[i] as string);
        const scale = Math.max(Math.abs(mine), Math.abs(theirs));
        // An exact zero on both sides is agreement, not a division by zero.
        const relative = scale === 0 ? 0 : Math.abs(mine - theirs) / scale;
        if (relative > worst) {
          worst = relative;
          worstAt = `sample ${i}: edfcore ${mine}, MNE ${theirs}, ${relative} relative`;
        }
      }
      expect(worst, `${expected.label}: ${worstAt}`).toBeLessThanOrEqual(MAX_RELATIVE_DIFFERENCE);
    }
  });

  it('is a real comparison — the values are not trivially equal', async () => {
    // If every sample landed on the same float the bound above would pass for any implementation.
    // Some distance is EXPECTED here, and its presence is what shows the conversion is real.
    const { golden } = load('edf-symmetric');
    const signal = golden.signals[0];
    if (signal === undefined) throw new Error('fixture missing');
    const values = signal.siBits.map(fromBits);
    expect(new Set(values).size).toBeGreaterThan(signal.sampleCount / 2);
    expect(Math.max(...values.map(Math.abs))).toBeGreaterThan(0);
  });
});

describe('MNE and edfcore agree about polarity, not only magnitude', () => {
  it('both report the negative-gain file as decreasing', async () => {
    // The check bit-parity cannot make: a field swap that both libraries made would be invisible
    // to a value comparison, so the SHAPE is asserted against the file's own declaration.
    const { golden, bytes } = load('edf-negative-gain');
    const expected = golden.signals[0];
    if (expected === undefined) throw new Error('fixture missing');

    const recording = await openEdf(byteSource(bytes));
    const signal = recording.header.signals[expected.index];
    if (signal === undefined) throw new Error('no signal');
    expect(signal.physicalMinimum).toBeGreaterThan(signal.physicalMaximum);

    const theirs = expected.siBits.map(fromBits);
    expect(theirs[0] as number).toBeGreaterThan(theirs[theirs.length - 1] as number);
  });
});
