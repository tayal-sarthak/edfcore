/**
 * An empty source and a short one are told apart, because the byte count already does.
 *
 * `SOURCE_TOO_SMALL` is the first thing a wrong path, a failed download or a half-written file
 * earns, and it offered one menu for all of them — "check that the whole file reached edfcore —
 * an empty file, a truncated download and a directory read all land here" — while printing, in the
 * same sentence, the number that says which. Nothing arrives here with zero bytes except a source
 * that has none, and nothing arrives with fifty except one that was cut short.
 *
 * It is the shape 0.6.26 fixed for `NOT_AN_EDF_FILE`, which listed the containers a file might be
 * while holding the magic number that identifies it. Same code, same field, same evidence; a
 * sentence that reads the evidence rather than restating the possibilities.
 *
 * The two `Next:` clauses are different actions, which is the point. Zero bytes is a question about
 * the path — does it name something that exists and has been written to. Fifty bytes is a question
 * about the transfer — does the size edfcore was given match the size on disk. A reader with the
 * old message had to decide which of those they were in.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

async function refusal(bytes: Uint8Array): Promise<string> {
  try {
    await openEdf(byteSource(bytes));
  } catch (error) {
    if (!isEdfError(error)) throw error;
    return error.message;
  }
  throw new Error('the bytes were accepted');
}

describe('a source with no bytes', () => {
  it('is called empty, and asked about the path', async () => {
    const message = await refusal(new Uint8Array(0));
    expect(message).toContain('the source is empty');
    expect(message).toContain('Next: check that the path or URL names a file that exists');
    expect(message).toContain('produce no bytes at all');
  });

  it('does not offer the menu it used to', async () => {
    expect(await refusal(new Uint8Array(0))).not.toContain('a truncated download and a directory');
  });
});

describe('a source that stops part way through the header', () => {
  it('says where it stopped, and asks about the transfer', async () => {
    const message = await refusal(new Uint8Array(200));
    expect(message).toContain('the source is 200 bytes');
    expect(message).toContain('stops part way through the 256-byte fixed header');
    expect(message).toContain('Next: compare the size edfcore was given with the size on disk');
  });

  it('is a different action from the empty one, which is the whole point', async () => {
    const empty = await refusal(new Uint8Array(0));
    const short = await refusal(new Uint8Array(200));
    const clause = (text: string): string => text.slice(text.indexOf('Next: '));
    expect(clause(empty)).not.toBe(clause(short));
  });

  it('holds at one byte and at 255, the two ends of the range', async () => {
    for (const size of [1, 255]) {
      const message = await refusal(new Uint8Array(size));
      expect(message).toContain(`the source is ${size} bytes`);
    }
  });
});

describe('what did not change', () => {
  it('is the code, the field and the evidence', async () => {
    for (const size of [0, 200]) {
      const inspection = await inspectEdf(byteSource(new Uint8Array(size)));
      const found = inspection.diagnostics.find((one) => one.code === 'SOURCE_TOO_SMALL');
      expect(found).toBeDefined();
      expect(found?.field).toBe('header');
      expect(found?.expected).toBe('at least 256 bytes');
      expect(found?.actual).toBe(`${size} bytes`);
    }
  });

  it('is the spec reference and the Next: clause every message ends with', async () => {
    for (const size of [0, 200]) {
      const message = await refusal(new Uint8Array(size));
      expect(message).toContain('EDF specification, header record bytes 0-255');
      expect(message).toContain('Next: ');
    }
  });

  it('is that a whole header is still accepted', async () => {
    const good = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    await expect(openEdf(byteSource(good))).resolves.toBeDefined();
  });
});
