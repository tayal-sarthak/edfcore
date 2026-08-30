/**
 * The ten microvolt values `quick-start.md` prints, checked against the scale it declares.
 *
 * That page prints two `Float64Array` blocks — five values from a window at `t = 0` in the browser
 * example, five more from a window at `t = 60` in the Node one. They are the first numbers anyone
 * sees from this library, and `quick-start-page.test.ts` runs everything around them: the header
 * listing, the sample count, the byte count, the annotation lines, the three refusals. The values
 * themselves it does not touch.
 *
 * They cannot be reproduced from the page, because the page names its file's geometry and not its
 * waveform. What they CAN be checked against is the scale that geometry implies, and that turns out
 * to be the check worth having: a physical value is `bitValue * (offset + digital)` for an integer
 * `digital`, so on a given declaration the reachable values are a lattice, and a float that is not
 * on it was produced by a different expression or a different range.
 *
 * That is not hypothetical. 0.5.6 found exactly that defect on `api-types.md`: two printed values
 * belonged to a file with a different digital range from the one the rest of the page's example
 * used, and the existing test checked five of the seven lines and stopped before them. A lattice
 * check catches that without needing the waveform, and would have caught it there.
 *
 * So each of the ten is inverted to a digital value, asserted to be a whole number inside the
 * declared range, and put back through `toPhysical` — the library's own expression, on a real
 * signal — and compared with `Object.is`. `toBeCloseTo` would pass on a value from the wrong scale.
 *
 * The page's own argument about the array type is checked with them: "`values` is a `Float64Array`,
 * because a 24-bit BDF sample scaled into float32 loses about a quarter of a quantisation step."
 * Every one of the ten changes under `Math.fround`, so the sentence is true of the very values
 * printed beneath it.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfSignal } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('quick-start.md') ?? '';

/** "EEG at 256 Hz, respiration at 16 Hz, and an annotations channel, in one-second records." */
const BYTES = buildEdf({
  plus: 'C',
  recordCount: 300,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 256 },
    { label: 'Resp oro-nasal', samplesPerRecord: 16 },
  ],
  annotationSignals: [{ samplesPerRecord: 30 }],
});

/** The two printed blocks: `Float64Array(5) [ … ]` and the bare `[ … ]` under the Node example. */
function printedBlocks(): readonly (readonly number[])[] {
  const blocks: number[][] = [];
  for (const match of PAGE.matchAll(/(?:Float64Array\(5\) )?\[\n((?:\s*-?\d+\.\d+,?\n)+)\]/g)) {
    blocks.push(
      (match[1] ?? '')
        .split('\n')
        .map((line) => line.trim().replace(/,$/, ''))
        .filter((line) => line !== '')
        .map(Number),
    );
  }
  return blocks;
}

const BLOCKS = printedBlocks();

async function eegSignal(): Promise<EdfSignal> {
  const recording = await openEdf(byteSource(BYTES));
  return getSignal(recording.header, 'EEG Fpz-Cz');
}

describe('the two blocks', () => {
  it('are on the page, five values each, so a passing run is not a vacuous one', () => {
    expect(BLOCKS).toHaveLength(2);
    for (const block of BLOCKS) expect(block).toHaveLength(5);
    expect(PAGE).toContain('Float64Array(5)');
  });

  it('are two different stretches of the recording, not one printed twice', () => {
    expect(BLOCKS[1]).not.toEqual(BLOCKS[0]);
    // The browser example reads from t = 0 and the Node one from t = 60.
    expect(PAGE).toContain('startSeconds: 0,');
    expect(PAGE).toContain('startSeconds: 60,');
  });

  it('come from a signal whose declaration the page’s geometry fixes', async () => {
    const signal = await eegSignal();
    expect(signal.samplesPerRecord).toBe(256);
    expect(signal.physicalDimension.trim()).toBe('uV');
    expect(signal.scale).toBeDefined();
  });
});

describe('every printed value', () => {
  it('is a physical value that signal can actually produce', async () => {
    const signal = await eegSignal();
    const scale = signal.scale;
    if (scale === undefined) throw new Error('the fixture signal has no scale');

    for (const block of BLOCKS) {
      for (const printed of block) {
        // Invert the page's number through the declared scale.
        const digital = Math.round(printed / scale.bitValue - scale.offset);
        expect(Number.isInteger(digital)).toBe(true);
        expect(digital).toBeGreaterThanOrEqual(signal.digitalMinimum);
        expect(digital).toBeLessThanOrEqual(signal.digitalMaximum);

        // And put it back through the library's own expression, bit for bit.
        const [converted] = toPhysical(signal, Int32Array.of(digital));
        expect(Object.is(converted, printed)).toBe(true);
      }
    }
  });

  it('would be a different number on a different declared range, which is why this is worth checking', async () => {
    const signal = await eegSignal();
    const scale = signal.scale;
    if (scale === undefined) throw new Error('the fixture signal has no scale');
    const printed = BLOCKS[0]?.[1];
    expect(printed).toBeDefined();
    const digital = Math.round((printed ?? 0) / scale.bitValue - scale.offset);

    // The same digital sample on a 12-bit declaration, which is the mismatch 0.5.6 found on
    // `api-types.md`: a printed value that belonged to a file the rest of the page did not describe.
    const twelveBit = await openEdf(
      byteSource(
        buildEdf({
          plus: 'C',
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [
            {
              label: 'EEG Fpz-Cz',
              samplesPerRecord: 256,
              raw: { digitalMinimum: '-2048', digitalMaximum: '2047' },
            },
          ],
          annotationSignals: [{ samplesPerRecord: 30 }],
        }),
      ),
    );
    const other = getSignal(twelveBit.header, 'EEG Fpz-Cz');
    const [elsewhere] = toPhysical(other, Int32Array.of(digital));
    expect(elsewhere).not.toBe(printed);
  });

  it('loses precision in float32, which is the page’s argument for Float64Array', () => {
    for (const block of BLOCKS) {
      for (const printed of block) {
        expect(Math.fround(printed)).not.toBe(printed);
      }
    }
    expect(PAGE.replace(/\s+/g, ' ')).toContain(
      'a 24-bit BDF sample scaled into float32 loses about a quarter of a quantisation step',
    );
  });
});

describe('the first value the browser example prints', () => {
  it('is what digital zero converts to, which is not physical zero', async () => {
    const signal = await eegSignal();
    const [atZero] = toPhysical(signal, Int32Array.of(0));
    expect(BLOCKS[0]?.[0]).toBe(atZero);
    // The digital range is not symmetric about zero, so neither is the map.
    expect(atZero).not.toBe(0);
  });
});
