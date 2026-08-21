/**
 * Three claims from the README's "Design in one page", each an absence that is hard to notice.
 *
 * "There's no recording-wide rate." A header field holding one would be the obvious convenience and
 * the wrong abstraction — an EDF file can hold EEG at 256 Hz beside a temperature probe at 1, and a
 * single rate can only be right for one of them. The check is that no such field exists.
 *
 * "`sampleRateHz` is `undefined` when the record duration is zero (which is legal EDF)." A rate is
 * `samplesPerRecord / recordDuration`, so a zero duration makes it a division by zero. `Infinity`
 * would be a number, would pass every `typeof` check, and would produce `NaN` for every time
 * converted through it. PhysioNet's hypnogram files really do declare zero.
 *
 * "There's no gap-filling and no option to enable it." The absence is the feature: an option to
 * fill a gap is an option to fabricate samples the amplifier never recorded, and once it exists
 * somebody's config turns it on. Checked as an absence across the option types.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replace(
  /\s+/g,
  ' ',
);
const TYPES = readFileSync(new URL('../../src/types.ts', import.meta.url), 'utf8');

describe('sample rates stay per-signal', () => {
  it('is claimed, with the three rates the README names', () => {
    expect(README).toContain("There's no recording-wide rate.");
    expect(README).toContain('EEG at 256 Hz, ECG at 512 Hz and');
  });

  it('gives every signal its own rate and the header none', async () => {
    const { header } = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [
            { label: 'EEG', samplesPerRecord: 256 },
            { label: 'ECG', samplesPerRecord: 512 },
            { label: 'Temp', samplesPerRecord: 1 },
          ],
        }),
      ),
    );
    expect(header.signals.map((signal) => signal.sampleRateHz)).toEqual([256, 512, 1]);
    // No field on the header carries a rate — the abstraction that can only be right for one
    // channel does not exist to be reached for.
    expect(Object.keys(header)).not.toContain('sampleRateHz');
    expect(Object.keys(header)).not.toContain('sampleRate');
  });

  it('leaves the rate undefined when the record duration is zero', async () => {
    // "which is legal EDF" — a PhysioNet hypnogram really does declare it.
    const { header } = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 2,
          recordDurationSeconds: 0,
          signals: [{ label: 'Stage', samplesPerRecord: 1 }],
        }),
      ),
    );
    expect(header.recordDurationSeconds).toBe(0);
    const stage = getSignal(header, 'Stage');
    expect(stage.sampleRateHz).toBeUndefined();
    // Not Infinity, which is what an unguarded division produces and what would then make every
    // time derived from it NaN.
    expect(stage.sampleRateHz).not.toBe(Number.POSITIVE_INFINITY);
    expect(stage.samplesPerRecord).toBe(1);
  });
});

describe('gaps are structural', () => {
  const GAPPED = minimalEdfPlus({
    plus: 'D',
    recordCount: 6,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
    recordOnsetSeconds: (record) => (record <= 2 ? record : record + 10),
  });

  it('returns an array even for a continuous file', async () => {
    const recording = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 4,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
        }),
      ),
    );
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 2,
      signalIndices: [0],
    });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toHaveLength(1);
  });

  it('returns an empty array for a window inside a gap', async () => {
    const opened = await openEdf(byteSource(GAPPED));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    expect(
      await readWindow(recording, { startSeconds: 6, durationSeconds: 1, signalIndices: [0] }),
    ).toEqual([]);
  });

  it('splits rather than filling, so nothing crosses the hole', async () => {
    const opened = await openEdf(byteSource(GAPPED));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 20,
      signalIndices: [0],
    });
    expect(chunks).toHaveLength(2);
    // No chunk spans the hole: each is a run of adjacent records.
    for (const chunk of chunks) {
      expect(Number(chunk.durationTicks)).toBe(
        chunk.records.count * Number(recording.header.recordDurationTicks),
      );
    }
    expect(chunks[1]?.precededByGap).toBeDefined();
  });

  it('offers no option to turn filling on', () => {
    // "There's no gap-filling and no option to enable it." Checked as an absence over every
    // option name the public types declare — the feature is that there is nothing to switch.
    expect(README).toContain("There's no gap-filling and no option to enable it.");
    const optionNames = [...TYPES.matchAll(/^\s{2}(?:readonly\s+)?([a-z][\w]*)\??\s*[:(]/gm)].map(
      ([, name = '']) => name,
    );
    expect(optionNames.length).toBeGreaterThan(20);
    for (const name of optionNames) {
      expect(name.toLowerCase(), name).not.toMatch(/fill|interpolat|stitch|bridge/);
    }
  });
});

describe('the axis a window is measured on', () => {
  it('is the one the README sends you to', () => {
    expect(README).toContain(
      'against a window use `onsetTicksFromFirstRecord`, the axis reads measure from',
    );
  });

  it('puts an annotation inside the chunk that covers it, on that axis and not the other', async () => {
    // A sub-second start offset is what separates the two axes; without one they agree and the
    // advice would be untestable.
    const bytes = minimalEdfPlus({
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [
        {
          samplesPerRecord: 40,
          // Chosen so the half-second shift moves the event into a different RECORD: on the
          // header axis 4.25 s, on the rebased one 3.75 s. A smaller offset leaves both inside the
          // same record-aligned chunk and the advice becomes untestable.
          tals: (record) => (record === 4 ? [{ onset: 4.25, texts: ['Spindle'] }] : []),
        },
      ],
      recordOnsetSeconds: (record) => 0.5 + record,
    });
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 6 });
    const event = annotations.find((entry) => entry.text === 'Spindle');
    expect(event).toBeDefined();

    const [chunk] = await readWindow(recording, {
      startSeconds: 3,
      durationSeconds: 1,
      signalIndices: [0],
    });
    const start = chunk?.startTicks ?? 0n;
    const end = start + (chunk?.durationTicks ?? 0n);

    const onFirstRecord = event?.onsetTicksFromFirstRecord ?? 0n;
    expect(onFirstRecord >= start && onFirstRecord < end).toBe(true);
    // The header-axis value is half a second later and falls outside that window.
    expect((event?.onsetTicks ?? 0n) >= end).toBe(true);
  });
});
