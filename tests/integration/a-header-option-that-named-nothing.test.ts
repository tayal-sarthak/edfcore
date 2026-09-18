/**
 * `formatValidationReport`'s `header` option, given the recording.
 *
 * It is the one field on these options that is an object, and the recording is what a caller is
 * holding: the line above is `validateRecording(recording)`, so
 * `formatValidationReport(report, { header: recording })` is one field short of it. The option's
 * whole job is the difference between `EEG Fpz-Cz` and `signal 0`, which makes it the one a caller
 * adds last, to a call that already worked.
 *
 * Nothing checked it. The first argument has been guarded since 0.6.113, and the options object
 * since `assertOptions` — the object INSIDE them was not.
 *
 * And it only fails once the report has signal statistics, because that is the only block this names
 * signals in. So the same call printed fine with `scanSamples` off and threw V8's `Cannot read
 * properties of undefined (reading '0')` with it on — or, for a chunk, `text is not iterable` out of
 * `printable`. Whether it failed at all depended on how much of the file had been read.
 */

import { describe, expect, it } from 'vitest';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording, ValidationReport } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 16 },
    { label: 'EMG Chin', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function swept(): Promise<{ recording: EdfRecording; report: ValidationReport }> {
  const recording = await openEdf(byteSource(FILE));
  return { recording, report: await validateRecording(recording, { scanSamples: true }) };
}

describe('the option given something that is not a header', () => {
  it.each([
    ['the recording', (recording: EdfRecording): unknown => recording],
    ['its timeline', (recording: EdfRecording): unknown => recording.timeline],
    ['its index', (recording: EdfRecording): unknown => recording.index],
    ['a number', (): unknown => 5],
  ])('names the option rather than failing inside the row builder: %s', async (_name, pick) => {
    const { recording, report } = await swept();
    let thrown: Error | undefined;
    try {
      formatValidationReport(report, { header: pick(recording) } as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the rows were built from it').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown?.message).toContain('options.header is not a header');
    expect(thrown?.message).toContain('Next:');
  });

  it('is refused whether or not the report has rows to name', async () => {
    // The old failure only fired once `scanSamples` had produced signal statistics, so the same
    // mistake printed fine or threw depending on how much of the file had been read.
    const recording = await openEdf(byteSource(FILE));
    const cheap = await validateRecording(recording);
    expect(cheap.signalStats).toEqual([]);
    expect(() => formatValidationReport(cheap, { header: recording } as never)).toThrow(
      /options.header is not a header/,
    );
  });

  it('is refused for a chunk, which has a signals array of its own', async () => {
    const { recording, report } = await swept();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    // Being an array is not the test — a chunk's `signals` is one, and its entries carry no label
    // for a row to be named with. It threw `text is not iterable` out of `printable`.
    let thrown: Error | undefined;
    try {
      formatValidationReport(report, { header: chunks[0] } as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toContain('options.header is not a header');
  });
});

describe('the header itself', () => {
  it('still names the rows', async () => {
    const { recording, report } = await swept();
    const text = formatValidationReport(report, { header: recording.header });
    expect(text).toContain('EEG Fpz-Cz');
    expect(text).toContain('EMG Chin');
  });

  it('still prints without it, with the rows numbered', async () => {
    const { report } = await swept();
    const text = formatValidationReport(report);
    expect(text).toContain('signal 0');
    expect(text).not.toContain('EEG Fpz-Cz');
  });

  it('leaves the other options doing what they did', async () => {
    const { recording, report } = await swept();
    const text = formatValidationReport(report, {
      header: recording.header,
      maxItems: 1,
      redactFields: ['patientId'],
    });
    expect(text).toMatch(/^(PASS|FAIL) —/);
  });
});
