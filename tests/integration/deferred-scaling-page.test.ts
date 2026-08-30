/**
 * The unscalable signal `diagnostics.md` walks through, from the throw to the read.
 *
 * That page uses one file for three separate arguments and prints values for all three: the
 * `strict` transcript, the callout headed "`errors > 0` does not mean the file failed to read",
 * and the `EdfScalingError` block at the bottom. They are the same signal — one whose header
 * declares `digitalMinimum == digitalMaximum` — seen from three angles, and none of the three was
 * run.
 *
 * The `strict` transcript is four fields off a thrown error and a fifth off the diagnostic inside
 * it: `DEGENERATE_DIGITAL_RANGE digitalMinimum 504 1`, then `EDF+ additional specification 5`.
 * `504` is the sharpest of them. It is the byte at which signal 1's `digitalMinimum` field starts
 * in a two-signal file, which is `256 + 2 * 120 + 8`, and it is the number a reader would take to
 * a hex editor. Nothing computed it; `error-fields.test.ts` checks that the fields exist and
 * `spec-references.test.ts` that every diagnostic cites something, and neither of them is pointed
 * at this file.
 *
 * The callout is the one worth having under test. It says `errors > 0` and `report.ok === false`
 * are both true of a file that reads perfectly, and tells the reader to gate on the thrown
 * `EdfError` instead. That is a claim about three values agreeing on one file, made in prose, and
 * the file it describes is exactly this one — so all three are read off it here.
 *
 * What this does NOT check: which conditions leave a signal without a scale, or the order they are
 * checked in. That is `scaling-page-arithmetic.test.ts`, against `physical-values.md`. This is the
 * consequence for a caller who has one.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { EdfFormatError, EdfScalingError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording, EdfSignal } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('diagnostics.md') ?? '';

/**
 * Two signals, the second of which declares `digitalMinimum == digitalMaximum == 0`. Two is what
 * puts signal 1's `digitalMinimum` field at byte 504, and `Temp rectal` is the label the page's
 * own `EdfScalingError` block prints.
 */
const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 4 },
    {
      label: 'Temp rectal',
      samplesPerRecord: 4,
      raw: { digitalMinimum: '0', digitalMaximum: '0' },
    },
  ],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(BYTES));

/** Keeps the non-null assertions the lint rules forbid out of every assertion below. */
function signalAt(recording: EdfRecording, index: number): EdfSignal {
  const signal = recording.header.signals[index];
  if (signal === undefined) throw new Error(`fixture has no signal ${index}`);
  return signal;
}

async function digitalOf(recording: EdfRecording, signal: EdfSignal): Promise<Int32Array> {
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 1 },
    signalIndices: [signal.index],
  });
  const series = chunk.signals[0];
  if (series === undefined) throw new Error('one signal was asked for and none came back');
  return series.digital;
}

describe('the strict transcript', () => {
  /** `// DEGENERATE_DIGITAL_RANGE digitalMinimum 504 1` — the four fields the page logs. */
  const PRINTED = /^\/\/ (DEGENERATE_DIGITAL_RANGE) (\w+) (\d+) (\d+)$/m.exec(PAGE);
  /** The line under it: `error.diagnostic?.specReference`. */
  const SPEC = /^\/\/ (EDF\+ additional specification \d+)$/m.exec(PAGE);

  it('is on the page, so a passing run is not a vacuous one', () => {
    expect(PRINTED).not.toBeNull();
    expect(SPEC).not.toBeNull();
  });

  it('is what a strict open throws, field for field', async () => {
    const thrown = await openEdf(byteSource(BYTES), { strict: true })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(EdfFormatError);
    const error = thrown as EdfFormatError;
    // The page's own guard, before it reads any of the four.
    expect(isEdfError(error)).toBe(true);
    expect(error.edfErrorKind).toBe('format');

    expect(error.code).toBe(PRINTED?.[1]);
    expect(error.field).toBe(PRINTED?.[2]);
    expect(error.byteOffset).toBe(Number(PRINTED?.[3]));
    expect(error.signalIndex).toBe(Number(PRINTED?.[4]));
    expect(error.diagnostic?.specReference).toBe(SPEC?.[1]);
  });

  it('names a byte the header layout actually puts the field at', async () => {
    const recording = await opened();
    // 256 fixed bytes, then ten per-signal blocks. `digitalMinimum` is the sixth, so it begins
    // after label(16) + transducer(80) + dimension(8) + physMin(8) + physMax(8) = 120 per signal.
    const signalCount = recording.header.signals.length;
    expect(signalCount).toBe(2);
    expect(Number(PRINTED?.[3])).toBe(256 + signalCount * 120 + 1 * 8);
  });

  it('loses nothing by throwing: the error carries the diagnostic it would have collected', async () => {
    const thrown = await openEdf(byteSource(BYTES), { strict: true })
      .then(() => undefined)
      .catch((error: unknown) => error);
    const carried = (thrown as EdfFormatError).diagnostic;

    const collected = (await opened()).header.diagnostics.find(
      (diagnostic) => diagnostic.code === 'DEGENERATE_DIGITAL_RANGE',
    );
    expect(collected).toBeDefined();
    expect(carried).toEqual(collected);
  });
});

describe('the callout: "errors > 0 does not mean the file failed to read"', () => {
  it('has errors > 0 on a file that opens without throwing', async () => {
    const recording = await opened();
    const summary = summarizeDiagnostics(recording.header.diagnostics);
    expect(summary.errors).toBeGreaterThan(0);
    expect(summary.worst).toBe('error');
  });

  it('and report.ok is false on it too, which is the alternative the callout rules out', async () => {
    const recording = await opened();
    const report = await validateRecording(recording, { scanSamples: true });
    expect(report.ok).toBe(false);
  });

  it('while every other signal reads and scales perfectly', async () => {
    const recording = await opened();
    const good = signalAt(recording, 0);
    expect(good.scale).toBeDefined();
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [0],
    });
    const series = chunk.signals[0];
    if (series === undefined) throw new Error('one signal was asked for and none came back');
    const physical = toPhysical(good, series.digital);
    expect(physical).toHaveLength(8);
    expect([...physical].every((value) => Number.isFinite(value))).toBe(true);
  });

  it('so the gate the callout names — did anything throw — is the one that is right', async () => {
    // Nothing threw, so the file read. Both counters say otherwise, and both are answering a
    // different question: "is this file conformant", not "can I read it".
    const recording = await opened();
    expect(recording.header.recordCount).toBe(2);
    expect(summarizeDiagnostics(recording.header.diagnostics).errors).toBeGreaterThan(0);
    expect((await validateRecording(recording, { scanSamples: true })).ok).toBe(false);
  });
});

describe('the signal itself', () => {
  it('has no scale, which the page says is visible in the type and not just at runtime', async () => {
    const recording = await opened();
    expect(signalAt(recording, 1).scale).toBeUndefined();
  });

  it('still decodes, and comes back as an Int32Array', async () => {
    const recording = await opened();
    const digital = await digitalOf(recording, signalAt(recording, 1));
    expect(digital).toBeInstanceOf(Int32Array);
    expect(digital).toHaveLength(4);
  });

  it('throws EdfScalingError from toPhysical, in the words the page quotes', async () => {
    const recording = await opened();
    const temp = signalAt(recording, 1);
    const digital = await digitalOf(recording, temp);

    const thrown = (() => {
      try {
        toPhysical(temp, digital);
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).toBeInstanceOf(EdfScalingError);
    const error = thrown as EdfScalingError;
    expect(error.code).toBe('DEGENERATE_DIGITAL_RANGE');
    expect(error.signalIndex).toBe(1);
    expect(error.label).toBe('Temp rectal');

    // The page elides the middle of the message with `...`; both ends are quoted verbatim.
    const quoted = /^\/\/ (EdfScalingError: \[DEGENERATE[\s\S]*?)$\n\n?```/m.exec(PAGE)?.[1] ?? '';
    const [head, tail] = quoted
      .replace(/\n\/\/ /g, ' ')
      .replace(/\s+/g, ' ')
      .split(' ... ');
    // Both halves have to be real text, or `startsWith('')` would vouch for anything.
    expect(head ?? '').toContain('Temp rectal');
    expect((head ?? '').length).toBeGreaterThan(80);
    expect(tail ?? '').toContain('will not invent a gain');
    expect((tail ?? '').length).toBeGreaterThan(40);

    const actual = `EdfScalingError: ${error.message}`.replace(/\s+/g, ' ');
    expect(actual.startsWith(head ?? '')).toBe(true);
    expect(actual.endsWith(tail ?? '')).toBe(true);
  });

  it('reports the same cause the header recorded, which is what "re-derived" has to mean', async () => {
    const recording = await opened();
    const temp = signalAt(recording, 1);
    const fromHeader = recording.header.diagnostics.find(
      (diagnostic) => diagnostic.signalIndex === 1,
    );
    const thrown = (() => {
      try {
        toPhysical(temp, new Int32Array(4));
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect((thrown as EdfScalingError).code).toBe(fromHeader?.code);
  });
});
