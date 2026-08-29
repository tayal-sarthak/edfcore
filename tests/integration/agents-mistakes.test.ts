/**
 * The six mistakes `AGENTS.md` tells a code generator to avoid, run.
 *
 * That file carries two lists. "Things that look like bugs and are not" is bound to tests by
 * `agents-rules.test.ts`, which fails if a rule is added without one. The other list — "The
 * mistakes to avoid, in order of how often they happen" — had `agents-snippet.test-d.ts`, which
 * compiles the code fence beneath it and so establishes that the example type-checks. Whether the
 * six sentences are true of a running file was not established anywhere.
 *
 * They are the sentences most likely to be acted on without being read carefully, because they are
 * written for something generating code rather than for someone reading documentation. Each one
 * describes a mistake that produces output rather than an error: microvolts that are really ADC
 * counts, a chunk that is really an array, an index computed from a rate that does not exist, an
 * event compared on the wrong axis, one rate assumed for a file that has three, a defect reported
 * as a value and never looked at.
 *
 * The fourth is the one with arithmetic in it, and it is checked as arithmetic: the two onset
 * fields "differ by record 0's sub-second offset", so the fixture declares one and the difference
 * is asserted against it rather than against zero. On a file with no offset the two are equal, and
 * a test written against such a file would pass while the sentence was wrong.
 *
 * The list is enumerated from `AGENTS.md`, so a seventh mistake added there is a mistake with no
 * test until it has one — the same binding the other list already has.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const AGENTS = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

/** The numbered list under "The mistakes to avoid", each entry's bold lead. */
const MISTAKES: readonly string[] = (() => {
  const at = AGENTS.indexOf('The mistakes to avoid, in order of how often they happen:');
  if (at === -1) throw new Error('AGENTS.md no longer lists the mistakes');
  const section = AGENTS.slice(at, AGENTS.indexOf('\n## ', at));
  return [...section.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map((match) => match[1] as string);
})();

/** A quarter-second start offset, so the two annotation axes cannot coincide. */
const START_OFFSET = 0.25;

/**
 * Three channels at three rates, one of them unscalable, on a file whose record 0 starts a quarter
 * of a second after the header clock.
 */
const BYTES = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  startOffsetSeconds: START_OFFSET,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8, sample: (r, k) => r * 8 + k + 1 },
    { label: 'ECG', samplesPerRecord: 4, sample: (r, k) => r * 4 + k + 1 },
    { label: 'Temp', samplesPerRecord: 1, sample: (r) => r + 1 },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 1 ? [{ onset: 1.75, texts: ['Lights off'] }] : []),
    },
  ],
});

const opened = async (): Promise<EdfRecording> => openEdf(byteSource(BYTES));

describe('the list was read', () => {
  it('found six mistakes, so a passing run is not a vacuous one', () => {
    expect(MISTAKES).toHaveLength(6);
    expect(new Set(MISTAKES).size).toBe(MISTAKES.length);
  });

  it('is the list this file is about, entry by entry', () => {
    // Bound by content rather than by position: a reordered list keeps its bindings, and a
    // rewritten entry loses one loudly.
    expect(MISTAKES[0]).toContain('digital` is raw stored integers, not microvolts');
    expect(MISTAKES[1]).toContain('returns an array');
    expect(MISTAKES[2]).toContain('Do not compute sample indices from `sampleRateHz`');
    expect(MISTAKES[3]).toContain('Compare event times in `bigint` ticks');
    expect(MISTAKES[4]).toContain('Signals have different sample rates');
    expect(MISTAKES[5]).toContain('Diagnostics are values on the result');
  });
});

describe('1. digital is raw stored integers, not microvolts', () => {
  it('differs from what toPhysical returns for the same samples', async () => {
    const recording = await opened();
    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 2,
      signalIndices: [0],
    });
    const entry = chunk?.signals[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    const signal = recording.header.signals[0];
    expect(signal?.scale).toBeDefined();
    if (signal === undefined) return;

    const physical = toPhysical(signal, entry.digital);
    expect(physical).toHaveLength(entry.digital.length);
    // Not merely a different type: a different NUMBER, on every sample. A generator that skipped
    // the conversion would publish ADC counts labelled as microvolts.
    for (const [at, value] of physical.entries()) {
      expect(value).not.toBe(entry.digital[at]);
    }
  });
});

describe('2. readWindow returns an array', () => {
  it('is an array even on a continuous file with one run', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 2,
      signalIndices: [0],
    });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toHaveLength(1);
    // The mistake the sentence is about: a chunk has no `signals` at the top level of the result.
    expect((chunks as unknown as { signals?: unknown }).signals).toBeUndefined();
  });
});

describe('3. do not compute sample indices from sampleRateHz', () => {
  it('leaves the rate undefined where samplesPerRecord is not', async () => {
    const zeroDuration = buildEdf({
      format: 'EDF',
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 0,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
    });
    const { header } = await openEdf(byteSource(zeroDuration));
    for (const signal of header.signals) {
      expect(signal.sampleRateHz, signal.label).toBeUndefined();
      // The field the sentence sends a caller to instead is there on the same signal.
      expect(Number.isSafeInteger(signal.samplesPerRecord)).toBe(true);
    }
  });
});

describe('4. compare event times in ticks, on the axis a read uses', () => {
  it('separates the two axes by record 0’s sub-second offset', async () => {
    const recording = await opened();
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const event = annotations[0];
    expect(event, 'the fixture carries no event to compare').toBeDefined();
    if (event === undefined) return;

    const offsetTicks = BigInt(START_OFFSET * 10_000_000);
    expect(recording.timeline.startOffsetTicks).toBe(offsetTicks);
    // "the two differ by record 0's sub-second offset" — asserted as that difference, on a file
    // that declares one. Where none is declared the two coincide and this says nothing.
    expect(event.onsetTicks - event.onsetTicksFromFirstRecord).toBe(offsetTicks);
    expect(offsetTicks).toBeGreaterThan(0n);
  });

  it('puts a read’s t = 0 on the from-first-record axis', async () => {
    const recording = await opened();
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const event = annotations[0];
    if (event === undefined) return;

    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: recording.header.recordCount,
      signalIndices: [0],
    });
    // The chunk starts at t = 0 of the read axis, which is the axis the event's
    // `onsetTicksFromFirstRecord` is measured on — not its `onsetTicks`.
    expect(chunk?.startTicks).toBe(0n);
    expect(event.onsetTicksFromFirstRecord).toBeGreaterThanOrEqual(chunk?.startTicks ?? 0n);
  });
});

describe('5. signals have different sample rates', () => {
  it('gives one file three of them, so there is no single rate to assume', async () => {
    const { header } = await opened();
    const rates = header.signals
      .filter((signal) => signal.kind === 'data')
      .map((signal) => signal.sampleRateHz);
    expect(new Set(rates).size).toBe(rates.length);
    expect(rates.length).toBeGreaterThan(2);
  });
});

describe('6. diagnostics are values on the result', () => {
  it('are on the header rather than thrown, and nothing reaches the console', async () => {
    const damaged = buildEdf({
      format: 'EDF',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Flat', samplesPerRecord: 4, digitalMinimum: 0, digitalMaximum: 0 }],
    });

    const calls: string[] = [];
    const console = globalThis.console as unknown as Record<string, unknown>;
    const saved = { ...console };
    for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
      console[name] = (): void => {
        calls.push(name);
      };
    }
    try {
      // No throw: the defect is an `error`-severity diagnostic and the file still parses.
      const { header } = await openEdf(byteSource(damaged));
      expect(header.diagnostics.some((entry) => entry.severity === 'error')).toBe(true);
      expect(header.signals[0]?.scale).toBeUndefined();
    } finally {
      Object.assign(console, saved);
    }
    expect(calls, 'edfcore wrote to the console').toEqual([]);
  });
});
