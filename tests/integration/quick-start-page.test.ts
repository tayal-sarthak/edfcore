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
import { isEdfError } from '../../src/errors.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

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

describe('the two onset axes', () => {
  /** Record 0 starting half a second in, which is the only sub-second timing EDF+ carries. */
  const START_OFFSET = 0.5;
  const ONSET = 1.75;

  const BYTES_OFFSET = minimalEdfPlus({
    recordCount: 3,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: (record) => (record === 1 ? [{ onset: ONSET, texts: ['Arousal'] }] : []),
      },
    ],
    recordOnsetSeconds: (record) => START_OFFSET + record,
  });

  const event = async () => {
    const recording = await openEdf(byteSource(BYTES_OFFSET));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 3 });
    const found = annotations.find((entry) => entry.text === 'Arousal');
    if (found === undefined) throw new Error('fixture lost its annotation');
    return found;
  };

  it('names both members of both pairs', () => {
    // Until 0.4.336 the page said "three ways" and named `onsetSecondsFromFirstRecord`,
    // `onsetSecondsFromHeaderStart` and `onsetTicks` — one float from each axis and one bigint
    // from only one of them.
    const flat = PAGE.replace(/\s+/g, ' ');
    for (const field of [
      'onsetSecondsFromFirstRecord',
      'onsetTicksFromFirstRecord',
      'onsetSecondsFromHeaderStart',
      'onsetTicks',
    ]) {
      expect(flat, field).toContain(`\`${field}\``);
    }
    expect(flat).toContain('from the *same axis*');
  });

  it('pairs each float with the bigint on its own axis', async () => {
    const found = await event();
    expect(found.onsetSecondsFromHeaderStart).toBe(ONSET);
    expect(found.onsetSecondsFromFirstRecord).toBe(ONSET - START_OFFSET);
    // "Print the seconds and compare the ticks — from the same axis."
    expect(Number(found.onsetTicks) / 1e7).toBe(found.onsetSecondsFromHeaderStart);
    expect(Number(found.onsetTicksFromFirstRecord) / 1e7).toBe(found.onsetSecondsFromFirstRecord);
  });

  it('separates the two axes by exactly the sub-second start offset', async () => {
    const found = await event();
    // "that offset is exactly what the two axes differ by"
    expect(Number(found.onsetTicks - found.onsetTicksFromFirstRecord) / 1e7).toBe(START_OFFSET);
  });

  it('puts an event in two places if the pair is crossed, which is what the page now warns about', async () => {
    const found = await event();
    // The advice as it read before: print the rebased seconds, compare the header-axis ticks.
    expect(Number(found.onsetTicks) / 1e7).not.toBe(found.onsetSecondsFromFirstRecord);
  });

  it('collapses the difference on a file with no offset, which is why it was easy to miss', async () => {
    const plain = minimalEdfPlus({
      recordCount: 3,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [
        {
          samplesPerRecord: 40,
          tals: (record) => (record === 1 ? [{ onset: ONSET, texts: ['Arousal'] }] : []),
        },
      ],
    });
    const recording = await openEdf(byteSource(plain));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 3 });
    const found = annotations.find((entry) => entry.text === 'Arousal');
    expect(found?.onsetTicks).toBe(found?.onsetTicksFromFirstRecord);
  });
});

/**
 * The listing block, with one thing it deliberately does NOT claim.
 *
 * The fixture is built from the page's own lines, so the onset values vouch for themselves: editing
 * `95.500` on the page edits both the file and the expectation, and this passes. That is the price
 * of keeping the fixture in step with the page, and it is worth stating rather than implying.
 *
 * What is not circular is everything between the two: the page's format string applied to the
 * fields edfcore returns has to reproduce the page's lines exactly. That catches a `durationSeconds`
 * that starts arriving as `0` instead of `undefined` — which would print `(+0 s)` on an event with
 * no duration, a different claim about the recording — and it catches a rebasing change in
 * `onsetSecondsFromFirstRecord`. The exactness check below is independent too: a decimal onset has
 * to survive the round trip as a whole number of ticks, whatever the page says the decimal is.
 */
describe('the annotation listing the page prints', () => {
  /**
   * `30.000 s (+30 s)  Sleep stage W` and `95.500 s  Arousal`.
   *
   * The ` {2}` before the text is the page's own separator, written by the snippet's
   * `` `  ${annotation.text}` ``, so it is spelled with a count rather than as two literal spaces.
   */
  const LINES = [...PAGE.matchAll(/^(\d+\.\d{3}) s(?: \(\+(\d+) s\))? {2}(.+)$/gm)].map(
    ([, onset = '', duration, text = '']) => ({
      onset: Number(onset),
      durationSeconds: duration === undefined ? undefined : Number(duration),
      text,
    }),
  );

  /** The page's own formatter, transcribed from the snippet above the block. */
  const format = (annotation: {
    onsetSecondsFromFirstRecord: number;
    durationSeconds: number | undefined;
    text: string;
  }): string => {
    const duration = annotation.durationSeconds;
    return (
      `${annotation.onsetSecondsFromFirstRecord.toFixed(3)} s` +
      (duration === undefined ? '' : ` (+${duration} s)`) +
      `  ${annotation.text}`
    );
  };

  const BYTES_EVENTS = minimalEdfPlus({
    recordCount: 100,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 60,
        tals: (record) =>
          LINES.filter((line) => Math.floor(line.onset) === record).map((line) =>
            line.durationSeconds === undefined
              ? { onset: line.onset, texts: [line.text] }
              : { onset: line.onset, duration: line.durationSeconds, texts: [line.text] },
          ),
      },
    ],
  });

  it('prints three events, one of them instantaneous', () => {
    expect(LINES).toHaveLength(3);
    expect(LINES.filter((line) => line.durationSeconds === undefined)).toHaveLength(1);
  });

  it('reproduces every line, through the page’s own format string', async () => {
    const recording = await openEdf(byteSource(BYTES_EVENTS));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const printed = annotations.filter((entry) => entry.text !== '').map((entry) => format(entry));
    expect(printed).toEqual(
      LINES.map((line) => format({ ...line, onsetSecondsFromFirstRecord: line.onset })),
    );
  });

  it('leaves durationSeconds undefined for the instantaneous one, rather than zero', async () => {
    // The page's formatter branches on `undefined`, so a zero would print `(+0 s)` on an event
    // that has no duration at all — which is a different claim about the recording.
    const recording = await openEdf(byteSource(BYTES_EVENTS));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const instantaneous = LINES.find((line) => line.durationSeconds === undefined);
    const found = annotations.find((entry) => entry.text === instantaneous?.text);
    expect(found?.durationSeconds).toBeUndefined();
  });

  it('carries every printed onset back as an exact number of ticks', async () => {
    // Independent of what the page prints: whatever the decimals are, a TAL onset is decimal text
    // and parsing it digit by digit is exact, so nothing may arrive as a fraction of a tick.
    const recording = await openEdf(byteSource(BYTES_EVENTS));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    for (const line of LINES) {
      const found = annotations.find((entry) => entry.text === line.text);
      expect(found?.onsetTicksFromFirstRecord, line.text).toBe(
        BigInt(Math.round(line.onset * 1e7)),
      );
    }
  });

  it('needs the record range the page says has no default', async () => {
    // "The record range is required and has no default. Scanning a whole file for annotations is
    //  expensive, so `{ start: 0, count: recording.header.recordCount }` has to appear in your
    //  source."
    expect(PAGE.replace(/\s+/g, ' ')).toContain('The record range is required and has no default');
    const recording = await openEdf(byteSource(BYTES_EVENTS));
    await expect(
      (readAnnotations as unknown as (r: unknown) => Promise<unknown>)(recording),
    ).rejects.toThrow();
  });
});

describe('the three refusals the page promises', () => {
  it('throws when the annotations index is passed to readWindow', async () => {
    // "Passing its index to `readWindow` throws." The page says it in one clause, and it is the
    // clause that stops a reader from plotting timestamped text as a waveform.
    expect(PAGE.replace(/\s+/g, ' ')).toContain('Passing its index to `readWindow` throws');
    const recording = await openEdf(byteSource(BYTES));
    const annotations = CHANNELS.find((channel) => channel.kind === 'annotations');
    await expect(
      readWindow(recording, {
        startSeconds: 0,
        durationSeconds: 1,
        signalIndices: [annotations?.index ?? -1],
      }),
    ).rejects.toThrow(/annotations channel/);
  });

  it('refuses a label that differs only in case, and lists the ones that exist', async () => {
    // "`getSignal` matches the trimmed label exactly and case-sensitively. When nothing matches it
    //  throws `EdfChannelNotFoundError`, listing every label in the file."
    const { header } = await openEdf(byteSource(BYTES));
    const wanted = CHANNELS[0]?.label ?? '';
    let thrown: unknown;
    try {
      getSignal(header, wanted.toLowerCase());
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(true);
    expect((thrown as Error).name).toBe('EdfChannelNotFoundError');
    // "listing every label in the file" — all three, not just the near miss.
    for (const channel of CHANNELS) {
      expect((thrown as Error).message, channel.label).toContain(channel.label);
    }
    // And the exact label still resolves, so the refusal is about the case and nothing else.
    expect(getSignal(header, wanted).label).toBe(wanted);
  });

  it('refuses a duplicated label, and lists the indices that carry it', async () => {
    // "When two channels share the label, which real files do, it throws
    //  `EdfAmbiguousChannelError`, listing the indices."
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4 },
        { label: 'Fp1', samplesPerRecord: 4 },
      ],
    });
    const { header } = await openEdf(byteSource(bytes));
    let thrown: unknown;
    try {
      getSignal(header, 'Fp1');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).name).toBe('EdfAmbiguousChannelError');
    expect((thrown as Error).message).toContain('indices 0, 1');
  });
});
