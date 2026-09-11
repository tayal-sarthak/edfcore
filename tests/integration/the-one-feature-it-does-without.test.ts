/**
 * `TextDecoder`, listed on `installation.md` among the features edfcore "relies on".
 *
 * It does not rely on it. `tal/grammar.ts` takes an ASCII fast path first, which is what almost
 * every recording's annotation text is, so the decoder is never built for them. When it is
 * needed and absent, the text run falls back to ISO-8859-1 and the read continues with an
 * `ANNOTATION_TEXT_NOT_UTF8` diagnostic — the `null` branch in `utf8Decoder()` exists for exactly
 * that, and its docblock says so: "the `null` branch exists so an exotic one degrades to Latin-1
 * with a diagnostic instead of throwing" (fixed in 0.6.64).
 *
 * Nothing about the floor changed, and this file asserts nothing about browser release history —
 * `browser-floor.test.ts` says why that is not a claim this repository can settle, and it still
 * pins the four-item basis string this page states. What changed is "relies on", which told a
 * reader on a runtime without `TextDecoder` that they were unsupported.
 *
 * The global is deleted for the duration of the reads below, which is the closest this suite can
 * get to that runtime. Each read goes through a FRESH module registry, because `utf8Decoder()`
 * memoises its answer — including the `null` — for the life of the module instance, so one
 * registry can demonstrate one branch and not both.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('installation.md') ?? '').replace(/\s+/g, ' ');

const file = (text: (record: number) => string): Uint8Array =>
  minimalEdfPlus({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      { samplesPerRecord: 60, tals: (record) => [{ onset: record + 0.5, texts: [text(record)] }] },
    ],
  });

const ASCII = file((record) => `event ${record}`);
const NON_ASCII = file((record) => `réveil ${record}`);

/** Runs `body` with `globalThis.TextDecoder` removed, and puts it back either way. */
async function withoutTextDecoder<T>(body: () => Promise<T>): Promise<T> {
  const globals = globalThis as Record<string, unknown>;
  const saved = globals.TextDecoder;
  delete globals.TextDecoder;
  try {
    return await body();
  } finally {
    globals.TextDecoder = saved;
  }
}

async function annotationsOf(bytes: Uint8Array) {
  const { byteSource } = await import('../../src/io/bytes.js');
  const { openEdf, readAnnotations } = await import('../../src/recording.js');
  const recording = await openEdf(byteSource(bytes));
  return readAnnotations(recording, { start: 0, count: 2 });
}

beforeEach(() => {
  vi.resetModules();
});

describe('a runtime with no TextDecoder', () => {
  it('reads a file whose annotation text is ASCII, unchanged', async () => {
    const result = await withoutTextDecoder(() => annotationsOf(ASCII));
    expect(result.annotations.map((annotation) => annotation.text)).toEqual(['event 0', 'event 1']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'ANNOTATION_TEXT_NOT_UTF8',
    );
  });

  it('reads one whose text is not, and says what it did instead of throwing', async () => {
    const result = await withoutTextDecoder(() => annotationsOf(NON_ASCII));
    expect(result.annotations).toHaveLength(2);
    // Latin-1 over the UTF-8 bytes: the two-byte é arrives as two characters.
    expect(result.annotations[0]?.text).toBe('rÃ©veil 0');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'ANNOTATION_TEXT_NOT_UTF8',
    );
  });

  it('is not how the same file reads when the decoder is there', async () => {
    const result = await annotationsOf(NON_ASCII);
    expect(result.annotations[0]?.text).toBe('réveil 0');
  });
});

describe('the installation page', () => {
  it('no longer says edfcore relies on all four', () => {
    expect(PAGE).not.toContain('the four platform features edfcore relies on');
  });

  it('says which of them it does without', () => {
    expect(PAGE).toContain('Only the first three are required');
    expect(PAGE).toContain('A runtime with no `TextDecoder` still reads a file');
  });
});
