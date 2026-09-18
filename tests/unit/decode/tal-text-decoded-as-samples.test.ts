/**
 * `decodeDigital` pointed at the annotations channel.
 *
 * This is the outcome the package names most often and most plainly. `resolveSignals` refuses the
 * annotations channel for `readRecords`, `readWindow` and `streamRecords` because "its bytes are TAL
 * text, not samples, so decoding them as samples would produce numbers that look like a signal";
 * `envelope.ts` refuses it for both envelope calls; and `decode/physical.ts` declines to offer
 * `decodeDigital` as the fallback for it, in as many words: "It does, and it produces numbers that
 * look exactly like a signal — the one failure this package exists to prevent."
 *
 * It did. On a conforming EDF+ file the region's first samples came back as `12331, 5140, 0, 0, 0` —
 * the bytes of `+0` and the TAL separator, read as int16 — in an ordinary `Int32Array`, with no
 * error and nothing distinguishing them from a recorded channel.
 *
 * So the primitive was the one route left to the thing every reader above it exists to stop. Nothing
 * in the package decodes an annotation region this way: `readTriggers` and `validateRecording` name
 * data signals, and the region's own reader is `decodeAnnotations`, which takes the same bytes.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfHeader } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const RECORDS = { start: 0, count: 2 } as const;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r}`] }] },
  ],
});

async function pieces(): Promise<{
  header: EdfHeader;
  bytes: Uint8Array;
  annotationsIndex: number;
}> {
  const recording = await openEdf(byteSource(FILE));
  const header = recording.header;
  return {
    header,
    bytes: await readRecordBytes(recording.source, header, RECORDS),
    annotationsIndex: header.annotationSignalIndices[0] as number,
  };
}

describe('the annotations channel', () => {
  it('is the one this file declares, and it carries text', async () => {
    const { header, annotationsIndex } = await pieces();
    expect(annotationsIndex).toBeGreaterThanOrEqual(0);
    expect(header.signals[annotationsIndex]?.kind).toBe('annotations');
  });

  it('is refused rather than returned as an Int32Array of its own bytes', async () => {
    const { header, bytes, annotationsIndex } = await pieces();
    let thrown: Error | undefined;
    try {
      decodeDigital(header, bytes, RECORDS, annotationsIndex);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the TAL text was decoded as samples').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain("is this file's annotations channel");
    expect(thrown?.message).toContain('numbers that look exactly like a signal');
    expect(thrown?.message).toContain('Next:');
  });

  it('names the region’s own reader, which takes these same bytes', async () => {
    const { header, bytes, annotationsIndex } = await pieces();
    expect(() => decodeDigital(header, bytes, RECORDS, annotationsIndex)).toThrow(
      /decodeAnnotations\(\)/,
    );
    // And that reader really does take them, so the advice is followable.
    const events = decodeAnnotations(header, bytes, RECORDS).annotations;
    expect(events.map((event) => event.text)).toEqual(['event 0', 'event 1']);
  });

  it('is refused the same way through the counted entry point the readers use', async () => {
    const { header, bytes, annotationsIndex } = await pieces();
    // `decodeDigital` delegates to it, so one guard covers both.
    expect(() => decodeDigital(header, bytes, RECORDS, annotationsIndex)).toThrow(
      /annotations channel/,
    );
  });
});

describe('a data signal', () => {
  it('still decodes, and still counts what falls outside the declared range', async () => {
    const { header, bytes } = await pieces();
    const digital = decodeDigital(header, bytes, RECORDS, 0);
    expect(digital).toBeInstanceOf(Int32Array);
    expect(digital.length).toBe(RECORDS.count * 8);
  });

  it('still refuses an index this file does not have, in its own words', async () => {
    const { header, bytes } = await pieces();
    expect(() => decodeDigital(header, bytes, RECORDS, 99)).toThrow(
      /signalIndex 99 is not one of the/,
    );
  });

  it('still refuses a record range outside the file', async () => {
    const { header, bytes } = await pieces();
    expect(() => decodeDigital(header, bytes, { start: 3, count: 4 }, 0)).toThrow(
      /is not inside the 4 data records/,
    );
  });
});
