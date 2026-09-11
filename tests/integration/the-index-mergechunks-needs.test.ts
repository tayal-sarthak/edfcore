/**
 * The call `chunks.ts` describes, made with the index a reader actually holds.
 *
 * `mergeChunks` exists because `readWindow` "splits at every discontinuity, so a window over an
 * EDF+D file comes back as one chunk per contiguous run". That is true of a COMPLETE index and
 * false of the one `openEdf` returns: with a probed index the same call throws, because two
 * probes cannot say where a gap is, and the refusal says so.
 *
 * So the module's opening paragraph described a call that throws on the index in hand, and never
 * mentioned `buildRecordIndex` — the step between a reader and the several chunks this module is
 * for. `recording.ts`, the README and `discontinuous.md` all carry the qualifier; this one did
 * not (fixed in 0.6.71).
 *
 * The two calls are made below, on one file, so the difference is the index and nothing else.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const CHUNKS_MODULE = readFileSync(new URL('../../src/chunks.ts', import.meta.url), 'utf8');

/** Eight one-second records with a five-second hole after the fourth. */
const WITH_A_GAP = buildEdf({
  plus: 'D',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
  recordOnsetSeconds: (record) => (record < 4 ? record : record + 5),
});

const SELECTION = { signalIndices: [0], startSeconds: 0, durationSeconds: 20 } as const;

describe('a window across the gap', () => {
  it('throws on the index openEdf hands you, rather than returning several chunks', async () => {
    const recording = await openEdf(byteSource(WITH_A_GAP));
    expect(recording.index.coverage).toBe('probed');
    const thrown = await readWindow(recording, SELECTION).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown, 'the probed index mapped the window').toBeDefined();
    // A plain RangeError, not an EdfError: the file is fine and the index passed was not enough.
    // `api-errors.md` lists this among the three cases where `isEdfError` says false.
    expect(thrown).toBeInstanceOf(RangeError);
    expect(isEdfError(thrown)).toBe(false);
    expect((thrown as Error).message).toContain('gap');
  });

  it('returns one chunk per contiguous run once the index is complete', async () => {
    const recording = await openEdf(byteSource(WITH_A_GAP));
    const index = await buildRecordIndex(recording);
    expect(index.coverage).toBe('complete');
    const chunks = await readWindow({ ...recording, index }, SELECTION);
    expect(chunks).toHaveLength(2);
  });

  it('and those are the chunks mergeChunks refuses to join', async () => {
    const recording = await openEdf(byteSource(WITH_A_GAP));
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow({ ...recording, index }, SELECTION);
    expect(() => mergeChunks(chunks)).toThrow(RangeError);
  });
});

describe('the docblock that sends a reader here', () => {
  it('no longer states the split without its precondition', () => {
    expect(CHUNKS_MODULE).not.toContain(
      'over an EDF+D file comes back as one chunk per contiguous run. Code',
    );
  });

  it('names the call that supplies it', () => {
    expect(CHUNKS_MODULE.slice(0, CHUNKS_MODULE.indexOf('\n */'))).toContain('buildRecordIndex');
  });
});
