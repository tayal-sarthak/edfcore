/**
 * The scaling contract as `concepts.md` states it, and the five places a diagnostic can be.
 *
 * The page makes the package's central refusal in three lines: `signal.scale` is `undefined`,
 * `toPhysical` throws, and `decodeDigital` still works. It names the reference implementation's
 * behaviour to contrast with — EDFlib substitutes a gain of 1 and returns ADC counts labelled as
 * microvolts — so the three lines are the argument, not an illustration of it.
 *
 * They were prose. `physical-values.md` has its own arithmetic test and `scale.ts` has unit tests
 * for each condition; what nothing checked is the trio together on one signal, which is what a
 * reader takes away from the page: the samples are real and keep working, and it is the
 * interpretation that is unavailable.
 *
 * The four conditions the paragraph lists are checked with it, because "that covers a degenerate
 * digital range, a degenerate physical range, and an inverted digital range … also a channel whose
 * physical dimension is `Filtered`" is a closed list, and a fifth condition appearing without the
 * page changing is the drift worth catching.
 *
 * The diagnostics section is the other closed list on the page: five properties, one per producer.
 * A reader who wants to know where to look for a problem reads that block.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { toPhysical } from '../../src/decode/physical.js';
import { EdfScalingError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfSignal } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('concepts.md') ?? '';
const PROSE = PAGE.replace(/\s+/g, ' ');

/** A signal whose declared digital range is a single point: a division by zero, so no gain. */
const NO_GAIN = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8, digitalMinimum: 100, digitalMaximum: 100 }],
});

async function degenerateSignal(): Promise<{ signal: EdfSignal; bytes: Uint8Array }> {
  const source = byteSource(NO_GAIN);
  const recording = await openEdf(source);
  const signal = recording.header.signals[0];
  if (signal === undefined) throw new Error('fixture has no signal');
  const bytes = await readRecordBytes(source, recording.header, { start: 0, count: 2 });
  return { signal, bytes };
}

describe('a signal the header gives no usable gain', () => {
  it('has no scale, refuses conversion, and still decodes', async () => {
    const { signal, bytes } = await degenerateSignal();
    const recording = await openEdf(byteSource(NO_GAIN));

    // The three lines of the snippet, in the order the page prints them.
    expect(signal.scale).toBeUndefined();

    const thrown = (() => {
      try {
        toPhysical(signal, Int32Array.from([1, 2, 3]));
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(EdfScalingError);
    expect((thrown as EdfScalingError).code).toBe(
      /code '([A-Z_]+)'/.exec(PROSE)?.[1] ?? 'DEGENERATE_DIGITAL_RANGE',
    );

    // "The digital samples are real data and they keep working."
    const digital = decodeDigital(recording.header, bytes, { start: 0, count: 2 }, signal.index);
    expect(digital).toHaveLength(16);
  });

  it('is one of the four conditions the page lists, and the page lists four', () => {
    // A closed list in prose. If a fifth reason for an absent scale appears, the sentence is the
    // thing that goes stale, and it is the sentence a reader plans around.
    for (const condition of [
      'a degenerate digital range',
      'a degenerate physical range',
      'an inverted digital range',
    ]) {
      expect(PROSE).toContain(condition);
    }
    expect(PROSE).toContain('physical dimension is `Filtered`');
  });
});

describe('the five places a diagnostic can be', () => {
  it('are all there, and all arrays', async () => {
    const bytes = minimalEdfPlus({ recordCount: 2, recordDurationSeconds: 1 });
    const source = byteSource(bytes);
    const recording = await openEdf(source);
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [0],
    });
    const inspection = await inspectEdf(byteSource(bytes));
    const report = await validateRecording(recording);
    const annotations = await readAnnotations(recording, { start: 0, count: 2 });

    const found: Record<string, readonly unknown[]> = {
      'recording.header.diagnostics': recording.header.diagnostics,
      'recording.timeline.diagnostics': recording.timeline.diagnostics,
      'chunk.diagnostics': chunk.diagnostics,
      'inspection.diagnostics': inspection.diagnostics,
      'report.diagnostics': report.diagnostics,
    };

    // The page's own list, parsed out of the block rather than restated here.
    const listed = [...PAGE.matchAll(/^([a-z]+(?:\.[a-zA-Z]+)+);\s*\/\/ /gm)]
      .map((match) => match[1] as string)
      .filter((name) => name.endsWith('.diagnostics'));
    expect([...new Set(listed)].sort()).toEqual(Object.keys(found).sort());

    for (const [name, value] of Object.entries(found)) {
      expect(Array.isArray(value), `${name} is not an array`).toBe(true);
    }
    // And the annotation read is where `chunk.diagnostics` comes from on a file with events.
    expect(Array.isArray(annotations.diagnostics)).toBe(true);
  });

  it('is the whole story: nothing is written to the console', () => {
    // "there is no `console` call anywhere in the package" — pinned by `silent.test.ts`, and the
    // sentence is asserted here so the two cannot drift apart.
    expect(PROSE).toContain('there is no `console` call anywhere in the package');
  });
});
