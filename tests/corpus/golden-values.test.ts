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

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

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

describe('the case list covers what is on disk', () => {
  it('has a case for every committed golden that carries samples', () => {
    // `CASES` is written out rather than globbed because each entry carries the reason it exists,
    // and a directory listing cannot say why `edf-negative-gain` is worth a file. That leaves the
    // list able to fall behind `scripts/golden/generate.py`: a golden generated and committed
    // without an entry here is a reference value nothing compares against, which looks exactly
    // like coverage until someone opens the directory. Adding one stays a deliberate act; missing
    // the second half of it no longer passes.
    const directory = fileURLToPath(new URL('./golden/', import.meta.url));
    const sampleGoldens = readdirSync(directory)
      .filter(
        (entry) =>
          entry.endsWith('.json') && !entry.endsWith('.mne.json') && !entry.startsWith('corpus-'),
      )
      .map((entry) => entry.slice(0, -'.json'.length))
      .filter((name) => {
        const parsed = JSON.parse(readFileSync(goldenDir(`${name}.json`), 'utf8')) as {
          signals?: unknown;
        };
        return Array.isArray(parsed.signals);
      });

    expect(sampleGoldens.length).toBeGreaterThan(1);
    expect([...sampleGoldens].sort()).toEqual([...CASES].sort());
  });
});

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

  it('disagrees on exactly the count physical-values.md publishes, with the value it prints', () => {
    // The page justifies the whole pinning with one measurement: "Substituting the numerically
    // better textbook expression fails it on 140 of 256 samples of the symmetric fixture — for
    // example `-492.15686274509807` where pyEDFlib says `-492.156862745098`."
    //
    // The bound above says "more than a quarter", which is the right shape for an argument that
    // the fixtures can tell the two forms apart. It is the wrong shape for a sentence quoting an
    // exact count and an exact pair of values, and that sentence is the page's entire evidence.
    // So the numbers are read out of the page and reproduced from the committed pyEDFlib output.
    // Read with the page's line wrapping collapsed: the sentence wraps mid-claim, and rewrapping
    // a paragraph must not be able to switch this check off.
    const page = (DOCS_PAGES.get('physical-values.md') ?? '').replace(/\s+/g, ' ');
    const claim =
      /fails it on (\d+) of (\d+) samples of the symmetric fixture [^`]*`(-?[\d.]+)` where pyEDFlib says `(-?[\d.]+)`/.exec(
        page,
      );
    expect(claim).not.toBeNull();

    const { golden } = load('edf-symmetric');
    const expected = golden.signals[0];
    if (expected === undefined) throw new Error('fixture missing');

    const gain =
      (expected.physicalMaximum - expected.physicalMinimum) /
      (expected.digitalMaximum - expected.digitalMinimum);

    let differing = 0;
    let firstPair: readonly [number, number] | undefined;
    for (let i = 0; i < expected.sampleCount; i += 1) {
      const textbook =
        expected.physicalMinimum +
        ((expected.digital[i] as number) - expected.digitalMinimum) * gain;
      const pyedflib = fromBits(expected.physicalBits[i] as string);
      if (Object.is(textbook, pyedflib)) continue;
      differing += 1;
      firstPair ??= [textbook, pyedflib];
    }

    expect(expected.sampleCount).toBe(Number(claim?.[2]));
    expect(differing).toBe(Number(claim?.[1]));
    // Printed as decimals rather than bits, so compared as the shortest round-trip of each.
    expect(String(firstPair?.[0])).toBe(claim?.[3]);
    expect(String(firstPair?.[1])).toBe(claim?.[4]);
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
