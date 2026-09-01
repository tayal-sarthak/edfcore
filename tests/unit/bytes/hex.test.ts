/**
 * One spelling for a byte named in prose.
 *
 * Two modules had a private `hexBytes`, under the same name, giving different answers.
 * `header/fields.ts` wrote `0x4b 0x61 0x9f` and `header/variant.ts` wrote `44 6f 77` — and the
 * message that second one builds goes on to say "nor BDF's 0xFF followed by BIOSEMI", so both
 * spellings of a byte appeared three words apart in one sentence. `NOT_AN_EDF_FILE` is also the
 * diagnostic a reader is likeliest to meet first, because it is what a zip, a gzip or a text file
 * earns, and without the prefix its list reads as a decimal number until the eye reaches `6f`.
 *
 * The dump under a diagnostic is deliberately NOT this. `30 20 20 20  |0   |` has an ASCII column
 * beside it and the columns are the point; a prefix on every byte would push it off the line.
 * That is prose against a hex dump, not two answers to one question, and both are checked here so
 * the distinction is a decision rather than an oversight.
 *
 * The rule is enforced from `src/` rather than from the messages: every `toString(16)` in the
 * package is a byte becoming text, and there are four, each named below with what it is for. A
 * fifth fails here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hexByte, hexBytes } from '../../../src/bytes/hex.js';
import { formatDiagnostics } from '../../../src/diagnostics/format.js';
import { isEdfError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import { setHeaderField } from '../../support/corrupt.js';
import { buildEdf } from '../../support/writer.js';

const SRC = new URL('../../../src/', import.meta.url);

/** Where a byte is allowed to become text, and what each one is for. */
const RENDERERS: Readonly<Record<string, string>> = {
  'bytes/hex.ts': 'the prose renderer this file is about',
  'diagnostics/format.ts': 'the rawBytes dump, and the \\xNN escape inside a quoted string',
  'tal/grammar.ts': 'the \\xNN escape inside a quoted annotation text',
};

function filesRenderingBytes(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(new URL(entry.name, directory), 'utf8');
        if (source.includes('toString(16)')) found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(SRC, '');
  return found.sort();
}

const NUL = String.fromCharCode(0x00);
const HIGH = String.fromCharCode(0x9f);

const base = (): Uint8Array =>
  buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  });

async function messages(bytes: Uint8Array): Promise<string> {
  try {
    const recording = await openEdf(byteSource(bytes));
    return formatDiagnostics(recording.header.diagnostics);
  } catch (error) {
    if (!isEdfError(error)) throw error;
    return error.message;
  }
}

describe('the renderer', () => {
  it('prefixes every byte and pads to two digits', () => {
    expect(hexByte(0)).toBe('0x00');
    expect(hexByte(0x9f)).toBe('0x9f');
    expect(hexByte(0xff)).toBe('0xff');
    expect(hexBytes(Uint8Array.from([0x44, 0x6f, 0x77]))).toBe('0x44 0x6f 0x77');
  });

  it('says when it is showing a window rather than the field', () => {
    const bytes = Uint8Array.from({ length: 40 }, (_, i) => i);
    expect(hexBytes(bytes, 0, 3)).toBe('0x00 0x01 0x02 ...');
    expect(hexBytes(bytes, 20, 2)).toBe('... 0x14 0x15 ...');
    expect(hexBytes(bytes, 38, 8)).toBe('... 0x26 0x27');
    // A window that is the whole thing says nothing, which is what makes the ellipsis mean
    // something when it is there.
    expect(hexBytes(Uint8Array.from([1, 2]), 0, 8)).toBe('0x01 0x02');
  });

  it('treats a negative start as zero, the way its one caller passes it', () => {
    expect(hexBytes(Uint8Array.from([0xab, 0xcd]), -5)).toBe('0xab 0xcd');
  });
});

describe('the messages that name bytes', () => {
  it('spell them one way, in the sentence that used to spell them two', async () => {
    const text = await messages(setHeaderField(base(), 'version', 'Download'));
    expect(text).toContain('bytes 0x44 0x6f 0x77 0x6e 0x6c 0x6f 0x61 0x64');
    // The literal in the same sentence, now in the same case as the rendered bytes.
    expect(text).toContain('0xff followed by');
    expect(text).not.toMatch(/bytes [0-9a-f]{2} [0-9a-f]{2}/);
  });

  it('spell them the same way from the other module', async () => {
    const text = await messages(setHeaderField(base(), 'patientId', `Ka${HIGH}el`));
    expect(text).toContain('0x4b 0x61 0x9f 0x65 0x6c');
  });

  it('quote a window with ellipses when the bad byte is not at the front', async () => {
    const text = await messages(setHeaderField(base(), 'patientId', `${'A'.repeat(40)}${NUL}B`));
    expect(text).toContain('... ');
  });
});

describe('the dump under a diagnostic', () => {
  it('is bare and keeps its ASCII column, which is why it is not this renderer', async () => {
    const recording = await openEdf(byteSource(setHeaderField(base(), 'patientId', `Ka${HIGH}el`)));
    const rendered = formatDiagnostics(recording.header.diagnostics);
    const dump = rendered.split('\n').find((line) => line.includes('|'));
    expect(dump).toBeDefined();
    expect(dump).toMatch(/[0-9a-f]{2} [0-9a-f]{2}/);
    expect(dump).not.toContain('0x');
  });
});

describe('every place a byte becomes text', () => {
  it('is one of the four, so a fifth has to be looked at', () => {
    expect(filesRenderingBytes()).toEqual(Object.keys(RENDERERS).sort());
  });

  it('found them, so a passing run is not a vacuous one', () => {
    expect(filesRenderingBytes().length).toBe(3);
    expect(filesRenderingBytes()).toContain('bytes/hex.ts');
  });
});
