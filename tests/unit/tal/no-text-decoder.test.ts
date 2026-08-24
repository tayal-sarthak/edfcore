/**
 * A runtime with no `TextDecoder`, which `tal/grammar.ts` is written for and nothing had run.
 *
 * `utf8Decoder()` builds one decoder and caches it, and the whole function is two branches: build
 * it, or record that this runtime has none. The second is documented — "every runtime edfcore
 * supports has `TextDecoder`; the `null` branch exists so an exotic one degrades to Latin-1 with a
 * diagnostic instead of throwing" — and every test in the suite runs on Node, where the global is
 * always there. Both the `null` and the message it selects were dead.
 *
 * The degradation is the whole point of the branch. Annotation text is the one place edfcore
 * decodes UTF-8, and a runtime without the global would otherwise throw from a getter while
 * parsing a file that is perfectly valid — losing the onsets, the timeline and every event, over
 * text nobody may even be reading.
 *
 * The message distinguishes the two causes, and that is the part worth pinning rather than the
 * code. `ANNOTATION_TEXT_NOT_UTF8` also fires for a text run that really is malformed, and the two
 * call for opposite responses: one is a broken file, the other is a working file on a runtime that
 * cannot check it. Both are asserted here, against each other.
 *
 * The global is stubbed rather than deleted, and restored before the file ends, so the cache the
 * module holds cannot leak into anything else.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdfDiagnostic, EdfHeader } from '../../../src/types.js';
import { minimalEdfPlus } from '../../support/writer.js';

/** É as one code point, written as an escape so this file stays ASCII. */
const TEXT = 'Épilepsie';

/** The same bytes read one at a time through ISO-8859-1, which is what the fallback does. */
const AS_LATIN1 = Array.from(new TextEncoder().encode(TEXT))
  .map((byte) => String.fromCharCode(byte))
  .join('');

const FIXTURE = minimalEdfPlus({
  recordCount: 1,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 60, tals: () => [{ onset: 0.5, texts: [TEXT] }] }],
});

/** Invalid UTF-8: a lone continuation byte, which no encoder produces. */
const MALFORMED = (() => {
  const bytes = minimalEdfPlus({
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 60, tals: () => [{ onset: 0.5, texts: ['ab'] }] }],
  });
  const at = bytes.indexOf(0x61, 512);
  bytes[at] = 0x80;
  return bytes;
})();

interface Decoded {
  readonly texts: readonly string[];
  readonly diagnostics: readonly EdfDiagnostic[];
  readonly header: EdfHeader;
}

/** Imported fresh every time, because the decoder is cached at module scope. */
async function decode(bytes: Uint8Array): Promise<Decoded> {
  const { parseHeader } = await import('../../../src/header/parse.js');
  const { decodeAnnotations } = await import('../../../src/tal/annotations.js');
  const header = parseHeader(bytes, bytes.byteLength);
  const result = decodeAnnotations(header, bytes.subarray(header.headerByteLength), {
    start: 0,
    count: 1,
  });
  return {
    texts: result.annotations.map((annotation) => annotation.text),
    diagnostics: result.diagnostics,
    header,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('on a runtime that has TextDecoder', () => {
  it('reads the text as UTF-8 and says nothing', async () => {
    const { texts, diagnostics } = await decode(FIXTURE);
    expect(texts).toEqual([TEXT]);
    expect(diagnostics).toEqual([]);
  });

  it('reports a text run that really is malformed, naming the file as the cause', async () => {
    const { diagnostics } = await decode(MALFORMED);
    const reported = diagnostics.find((d) => d.code === 'ANNOTATION_TEXT_NOT_UTF8');
    expect(reported?.message).toContain('the text run is not valid UTF-8');
    expect(reported?.message).not.toContain('no TextDecoder');
  });
});

describe('on a runtime that has none', () => {
  beforeEach(() => {
    vi.stubGlobal('TextDecoder', undefined);
    vi.resetModules();
  });

  it('falls back to ISO-8859-1 rather than throwing', async () => {
    const { texts } = await decode(FIXTURE);
    // Byte for byte, which is what Latin-1 means. Derived from the same string rather than
    // written out, so the expectation cannot drift from the fixture.
    expect(texts).toEqual([AS_LATIN1]);
    expect(texts[0]).not.toBe(TEXT);
  });

  it('names the runtime as the cause, not the file', async () => {
    const { diagnostics } = await decode(FIXTURE);
    const reported = diagnostics.find((d) => d.code === 'ANNOTATION_TEXT_NOT_UTF8');
    expect(reported?.message).toContain('this runtime has no TextDecoder');
    expect(reported?.message).toContain('decoded as ISO-8859-1');
    // The other cause would be a statement about the bytes, and these bytes are fine.
    expect(reported?.message).not.toContain('is not valid UTF-8');
    expect(reported?.severity).not.toBe('error');
  });

  it('keeps the timing, which is what the fallback exists to save', async () => {
    // The alternative to degrading is throwing from a getter, and that costs the onsets, the
    // timeline and every event on a file with nothing wrong with it.
    const { texts, header } = await decode(FIXTURE);
    expect(texts).toHaveLength(1);
    expect(header.annotationSignalIndices).toHaveLength(1);
  });
});
