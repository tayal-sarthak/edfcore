/**
 * The refusal `large-files.md` prints, printed by the library.
 *
 * That page's budget section is a transcript: three field values and the whole error message,
 * wrapped across three lines, for a named file — "an eight-hour, 30-channel, 256 Hz EDF (28,800
 * one-second records, 15,360 bytes each, 442,375,936 bytes in total)". A reader sizing a request
 * against `maxMaterializeBytes` reads those numbers and the sentence under them, and neither had
 * ever been compared with what `readRecords` actually throws.
 *
 * `budget-boundary.test.ts` owns the rule — the comparison is inclusive, in all five modules that
 * make it. This owns the page: that the arithmetic on it is this file's arithmetic, and that the
 * sentence quoted is the sentence emitted. A message reworded in `io/read.ts` leaves a transcript
 * on the site that no version of edfcore has ever produced, and the transcript is the part a
 * reader searches for when they hit it.
 *
 * The file is 442 MB and is never built. `readRecords` refuses BEFORE it allocates or reads, which
 * is the property the page is about, so a source that reports the length and serves the header is
 * all the test needs — and if the refusal ever stopped happening first, the read would ask for
 * 442,368,000 bytes of zeros and this would notice.
 */

import { describe, expect, it } from 'vitest';
import { EdfBudgetError } from '../../src/errors.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('large-files.md') ?? '';

/** The same page as one line, because a sentence stating a number may wrap across two. */
const PROSE = PAGE.replace(/\s+/g, ' ');

/** The page's numbers, with the thousands separators prose uses. */
const stated = (pattern: RegExp): number =>
  Number((pattern.exec(PROSE)?.[1] ?? '').replace(/[,\s]/g, ''));

const SIGNALS = 30;
const SAMPLES_PER_RECORD = 256;
const RECORD_BYTES = SIGNALS * SAMPLES_PER_RECORD * 2;
const HEADER_BYTES = 256 * (SIGNALS + 1);
const RECORDS = 28_800;

/**
 * The page's file, as a source rather than as bytes.
 *
 * A two-record file of the same geometry supplies the header; the record count field is rewritten
 * to the page's, and the source reports the length that count implies. Nothing past the header is
 * ever read, because the call under test refuses first.
 */
function eightHourRecording(): ByteSource {
  const bytes = buildEdf({
    signals: Array.from({ length: SIGNALS }, (_, index) => ({
      label: `EEG C${index}`,
      samplesPerRecord: SAMPLES_PER_RECORD,
    })),
    recordCount: 2,
    recordDurationSeconds: 1,
  });
  const count = String(RECORDS).padEnd(8, ' ');
  for (let i = 0; i < 8; i += 1) bytes[236 + i] = count.charCodeAt(i);

  const byteLength = HEADER_BYTES + RECORDS * RECORD_BYTES;
  return {
    byteLength,
    read: (offset: number, length: number) => {
      const out = new Uint8Array(length);
      if (offset < bytes.byteLength) {
        out.set(bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)));
      }
      return Promise.resolve(out);
    },
  };
}

async function refusal(): Promise<EdfBudgetError> {
  const recording = await openEdf(eightHourRecording());
  const caught = await readRecords(recording, {
    records: { start: 0, count: recording.header.recordCount },
    signalIndices: [0],
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(EdfBudgetError);
  return caught as EdfBudgetError;
}

describe('the file the page describes', () => {
  it('has the geometry the page states', async () => {
    // The premise. Every number below is arithmetic on these three, so a fixture that drifted
    // from the page would make the rest agree about the wrong file.
    const recording = await openEdf(eightHourRecording());
    expect(recording.header.signals).toHaveLength(SIGNALS);
    expect(recording.header.recordByteLength).toBe(stated(/records, ([\d,]+) bytes each/));
    expect(recording.header.recordCount).toBe(stated(/\(([\d,]+) one-second records/));
    expect(recording.source.byteLength).toBe(stated(/bytes each, ([\d,]+) bytes in total/));
  });
});

describe('reading all of it at once', () => {
  it('is refused with the two numbers the page prints', async () => {
    const error = await refusal();

    expect(error.requiredBytes).toBe(stated(/error\.requiredBytes;\s*\/\/ ([\d,]+)/));
    expect(error.budgetBytes).toBe(stated(/error\.budgetBytes;\s*\/\/ ([\d,]+)/));
    expect(error.optionName).toBe('maxMaterializeBytes');
  });

  it('and the budget it was measured against is the documented default', async () => {
    const error = await refusal();
    // "The default is 256 MiB (268,435,456 bytes)" — the sentence above the snippet.
    expect(error.budgetBytes).toBe(stated(/The default is 256 MiB \(([\d,]+) bytes\)/));
    expect(error.budgetBytes).toBe(256 * 1024 * 1024);
  });

  it('with the message the page quotes, word for word', async () => {
    // The transcript is a fenced block wrapped over three lines; the message is one line. Both
    // are collapsed, so the comparison is about the words and not about where the page wrapped.
    const quoted = /```\n(Reading records \{[^`]*?)\n```/.exec(PAGE)?.[1] ?? '';
    expect(quoted, 'no refusal transcript in large-files.md').not.toBe('');

    const error = await refusal();
    const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
    expect(collapse(error.message)).toBe(collapse(quoted));
  });
});

describe('nothing was read to find that out', () => {
  it('refuses before the range is fetched, which is what the page claims', async () => {
    // "Exceeding it throws EdfBudgetError **before** anything is allocated, not part-way through".
    const inner = eightHourRecording();
    let bytesRead = 0;
    const counted: ByteSource = {
      byteLength: inner.byteLength,
      read: (offset, length, options) => {
        bytesRead += length;
        return inner.read(offset, length, options);
      },
    };

    const recording = await openEdf(counted);
    const afterOpen = bytesRead;
    await readRecords(recording, {
      records: { start: 0, count: recording.header.recordCount },
      signalIndices: [0],
    }).catch(() => undefined);

    expect(bytesRead).toBe(afterOpen);
    // And opening really did read something, so this is not counting a source nobody touched.
    expect(afterOpen).toBe(HEADER_BYTES);
  });
});
