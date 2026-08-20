/**
 * The output blocks on `quick-start.md`, against the file that produces them.
 *
 * The page is the second thing a reader opens and the first one they run. It prints two `text`
 * blocks of console output, and between them they pin the whole shape of a read: the variant, the
 * record geometry, three channels with their kinds and sample counts, and the two numbers that
 * come out of a ten-second window — `2560 samples, 6040 bytes read`.
 *
 * That second number is the one worth holding. The page stops to explain it: 6040 "is more than
 * the 5120 bytes those 2560 samples occupy", because a record is the smallest readable unit and
 * every channel is interleaved into it. A reader who works out the overhead of a window from this
 * page is doing arithmetic that has to stay true — and it follows from the annotation channel's
 * width, which is a detail three lines further up the same block.
 *
 * The individual sample values are NOT checked. They come from a recording nobody here has, and
 * they illustrate the shape of the output rather than assert anything about the library; a fixture
 * reproducing them would be asserting against its own generator. Everything structural is checked,
 * and the file below is built from the block's own description of it.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('quick-start.md') ?? '';

/** `EDF+C: 300 records of 1 s` */
const GEOMETRY = /^(\S+): (\d+) records of (\d+) s$/m.exec(PAGE);

/** `  [0] EEG Fpz-Cz — data, 256 samples/record` */
const CHANNELS = [
  ...PAGE.matchAll(/^ {2}\[(\d+)\] (.+?) — (data|annotations), (\d+) samples\/record$/gm),
].map(([, index = '', label = '', kind = '', samples = '']) => ({
  index: Number(index),
  label,
  kind,
  samplesPerRecord: Number(samples),
}));

/** `2560 samples, 6040 bytes read` */
const READ = /^(\d+) samples, (\d+) bytes read$/m.exec(PAGE);

/** `startSeconds: 60,` / `durationSeconds: 10,` from the Node example. */
const WINDOW_SECONDS = Number(/startSeconds: (\d+),\s*\n\s*durationSeconds: 10,/.exec(PAGE)?.[1]);

/** The file the block describes, built from the block. */
const BYTES = (() => {
  const data = CHANNELS.filter((channel) => channel.kind === 'data');
  const annotations = CHANNELS.filter((channel) => channel.kind === 'annotations');
  return buildEdf({
    plus: 'C',
    recordCount: Number(GEOMETRY?.[2]),
    recordDurationSeconds: Number(GEOMETRY?.[3]),
    signals: data.map((channel) => ({
      label: channel.label,
      samplesPerRecord: channel.samplesPerRecord,
      physicalDimension: 'uV',
    })),
    annotationSignals: annotations.map((channel) => ({
      samplesPerRecord: channel.samplesPerRecord,
    })),
  });
})();

describe('the file the page prints', () => {
  it('states its own geometry and channels, so the fixture is the page’s', () => {
    expect(GEOMETRY).not.toBeNull();
    expect(READ).not.toBeNull();
    expect(CHANNELS).toHaveLength(3);
    expect(Number.isInteger(WINDOW_SECONDS)).toBe(true);
  });

  it('opens as the variant and geometry the first line reports', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    expect(header.variant).toBe(GEOMETRY?.[1]);
    expect(header.recordCount).toBe(Number(GEOMETRY?.[2]));
    expect(header.recordDurationSeconds).toBe(Number(GEOMETRY?.[3]));
  });

  it('lists the three channels the page lists, at the same indices', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    expect(header.signals).toHaveLength(CHANNELS.length);
    for (const channel of CHANNELS) {
      const signal = header.signals[channel.index];
      expect(signal?.label, `[${channel.index}]`).toBe(channel.label);
      expect(signal?.kind, channel.label).toBe(channel.kind);
      expect(signal?.samplesPerRecord, channel.label).toBe(channel.samplesPerRecord);
    }
  });

  it('keeps the annotations channel out of dataSignalIndices', async () => {
    // "edfcore reports its `kind` as `'annotations'` and keeps it out of `header.dataSignalIndices`."
    const { header } = await openEdf(byteSource(BYTES));
    const annotations = CHANNELS.find((channel) => channel.kind === 'annotations');
    expect(annotations).toBeDefined();
    expect([...header.dataSignalIndices]).not.toContain(annotations?.index);
    expect([...header.dataSignalIndices]).toEqual(
      CHANNELS.filter((channel) => channel.kind === 'data').map((channel) => channel.index),
    );
  });
});

describe('the two numbers the window prints', () => {
  const window = async () => {
    const recording = await openEdf(byteSource(BYTES));
    const eeg = getSignal(recording.header, CHANNELS[0]?.label ?? '');
    const chunks = await readWindow(recording, {
      startSeconds: WINDOW_SECONDS,
      durationSeconds: 10,
      signalIndices: [eeg.index],
    });
    return { recording, eeg, chunk: chunks[0] };
  };

  it('returns the sample count the page prints', async () => {
    const { chunk, eeg } = await window();
    expect(chunk?.signals[0]?.digital.length).toBe(Number(READ?.[1]));
    // Which is the window in records times this channel's own rate, and nothing else.
    expect(Number(READ?.[1])).toBe(10 * eeg.samplesPerRecord);
  });

  it('reads the byte count the page prints', async () => {
    const { chunk } = await window();
    expect(chunk?.byteLength).toBe(Number(READ?.[2]));
  });

  it('reads more than the samples occupy, by the width of the other channels', async () => {
    // "`chunk.byteLength` is the bytes that actually left the source, which is more than the 5120
    //  bytes those 2560 samples occupy."
    const occupied = Number(
      /more than the (\d+) bytes those \d+ samples occupy/.exec(PAGE.replace(/\s+/g, ' '))?.[1],
    );
    const { chunk, recording } = await window();
    expect(occupied).toBe(Number(READ?.[1]) * recording.header.bytesPerSample);
    expect(chunk?.byteLength).toBeGreaterThan(occupied);
    // The excess is exactly the other two channels' share of those ten records.
    expect((chunk?.byteLength ?? 0) - occupied).toBe(
      10 *
        recording.header.bytesPerSample *
        CHANNELS.slice(1).reduce((total, channel) => total + channel.samplesPerRecord, 0),
    );
  });

  it('converts to the unit the browser block names', async () => {
    // `EEG Fpz-Cz: 2560 samples of uV, 6040 bytes read from disk`
    const printed = /^(.+?): (\d+) samples of (\w+), (\d+) bytes read from disk$/m.exec(PAGE);
    expect(printed).not.toBeNull();
    const { chunk, eeg } = await window();
    expect(eeg.label).toBe(printed?.[1]);
    expect(eeg.physicalDimension).toBe(printed?.[3]);
    // The browser block reads from 0 and the Node one from 60; both print the same two numbers,
    // which is the claim that a window costs the same wherever it starts on a continuous file.
    expect(toPhysical(eeg, chunk?.signals[0]?.digital ?? []).length).toBe(Number(printed?.[2]));
    expect(chunk?.byteLength).toBe(Number(printed?.[4]));
  });
});
