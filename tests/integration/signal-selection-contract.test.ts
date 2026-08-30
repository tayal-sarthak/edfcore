/**
 * `signalIndices`, and the five reads that must answer it the same way.
 *
 * `duplicate-signal-indices.test.ts` covers two of the rules `api-reading.md` states — duplicates
 * are dropped, the order given is the order returned — over `readRecords`, `readWindow` and
 * `streamRecords`. It does not reach the two envelope entry points, and nothing covers what the
 * option does when it is WRONG.
 *
 * The refusals are the part with a shape worth pinning, because there are two of them and they are
 * deliberately different classes. An index the file does not have is an `EdfChannelNotFoundError` —
 * an `EdfError`, carrying `selector` and `availableLabels` so a caller can offer the right one.
 * An index that names the annotations channel is a plain `RangeError`, because it can only ever be
 * a caller's mistake and never a file's: the bytes there are TAL text, and decoding them as samples
 * produces numbers that look exactly like a signal. `isEdfError` is what separates them, and a
 * caller writing one `catch` for bad files and another for bad calls depends on the split holding
 * at every entry point rather than at the one they tested against.
 *
 * There is no reason for five functions to diverge here — they share `resolveSignals` — and that is
 * exactly why it is worth a test: a sixth entry point, or one that grows its own validation to
 * report something friendlier, is how a shared rule stops being one. The five are enumerated out of
 * `src/`, so a sixth fails here until it is driven.
 *
 * `readAnnotations` and `decodeAnnotations` take a `signalIndices` too and are deliberately not in
 * the list: theirs selects ANNOTATION signals, so the two rules are inverted. That is
 * `secondary-annotation-signal.test.ts`.
 *
 * What this does NOT check: the cost of a duplicate, or that the samples are unaffected by one.
 * Those are `duplicate-signal-indices.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { EdfChannelNotFoundError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Fp2', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const ANNOTATIONS_INDEX = 2;

/** The signals each entry point came back with, in the order it returned them. */
type Selected = (recording: EdfRecording, signalIndices: readonly number[]) => Promise<number[]>;

const ENTRY_POINTS: ReadonlyArray<readonly [string, Selected]> = [
  [
    'readRecords',
    async (recording, signalIndices) =>
      (
        await readRecords(recording, { records: { start: 0, count: 1 }, signalIndices })
      ).signals.map((series) => series.signalIndex),
  ],
  [
    'readWindow',
    async (recording, signalIndices) => {
      const [chunk] = await readWindow(recording, {
        startSeconds: 0,
        durationSeconds: 2,
        signalIndices,
      });
      return (chunk?.signals ?? []).map((series) => series.signalIndex);
    },
  ],
  [
    'streamRecords',
    async (recording, signalIndices) => {
      for await (const chunk of streamRecords(recording, {
        startSeconds: 0,
        durationSeconds: 4,
        signalIndices,
      })) {
        return chunk.signals.map((series) => series.signalIndex);
      }
      return [];
    },
  ],
  [
    'readEnvelope',
    async (recording, signalIndices) => {
      const [chunk] = await readEnvelope(recording, {
        startSeconds: 0,
        durationSeconds: 4,
        buckets: 4,
        signalIndices,
      });
      return (chunk?.signals ?? []).map((series) => series.signalIndex);
    },
  ],
  [
    'readEnvelopeAtResolution',
    async (recording, signalIndices) => {
      const [chunk] = await readEnvelopeAtResolution(recording, {
        startSeconds: 0,
        durationSeconds: 4,
        secondsPerBucket: 1,
        signalIndices,
      });
      return (chunk?.signals ?? []).map((series) => series.signalIndex);
    },
  ],
];

const opened = (): Promise<EdfRecording> => openEdf(byteSource(BYTES));

async function thrownBy(call: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

describe('the entry points that take one', () => {
  function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
        continue;
      }
      if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
    }
    return into;
  }

  it('are the nine in src/, split by what their signalIndices selects', () => {
    const src = new URL('../../src/', import.meta.url);
    const names = sourceFiles(src, '', []).sort();
    const text = new Map(names.map((name) => [name, readFileSync(new URL(name, src), 'utf8')]));
    const all = [...text.values()].join('\n');

    /** True when `type` declares `signalIndices`, following `extends` and `&`. */
    const declares = (type: string, seen = new Set<string>()): boolean => {
      for (const part of type.split(/[&|,]/).map((piece) => piece.trim())) {
        if (!/^[A-Za-z_$][\w$]*$/.test(part) || seen.has(part)) continue;
        seen.add(part);
        const declaration = new RegExp(
          `export (?:interface|type) ${part}\\b(?: extends ([^{]+))?\\s*(?:=\\s*([^;]+);|\\{([\\s\\S]*?)\\n\\})`,
        ).exec(all);
        if (declaration === null) continue;
        if (/^\s*readonly signalIndices\??:/m.test(declaration[3] ?? '')) return true;
        for (const parent of [declaration[1], declaration[2]]) {
          if (parent !== undefined && declares(parent, seen)) return true;
        }
      }
      return false;
    };

    const found: string[] = [];
    for (const name of names) {
      for (const match of (text.get(name) ?? '').matchAll(
        /export (?:async )?function\*? (\w+)\(([\s\S]*?)\)(?::|\s*\{)/g,
      )) {
        const parameters = match[2] ?? '';
        const direct = /\bsignalIndices\s*:/.test(parameters);
        const viaType = [...parameters.matchAll(/:\s*([A-Z]\w+(?:\s*&\s*[A-Z]\w+)*)/g)].some(
          (parameter) => declares(parameter[1] ?? ''),
        );
        if (direct || viaType) found.push(match[1] ?? '');
      }
    }

    expect(found.sort()).toEqual(
      [
        // The shared helpers the five below all go through.
        'assertSignalIndices',
        // Annotation reads: theirs selects ANNOTATION signals, where the two rules invert.
        'decodeAnnotations',
        'readAnnotations',
        // The five under test.
        'readEnvelope',
        'readEnvelopeAtResolution',
        'readRecords',
        'readWindow',
        'resolveSignals',
        'streamRecords',
      ].sort(),
    );
    expect(ENTRY_POINTS).toHaveLength(5);
  });

  it('all agree on a selection that is fine, so the fixture is not the reason they agree', async () => {
    const recording = await opened();
    for (const [name, select] of ENTRY_POINTS) {
      expect(await select(recording, [0, 1]), name).toEqual([0, 1]);
    }
  });
});

describe('an index the file does not have', () => {
  it.each([9, -1, 0.5])(
    'is an EdfChannelNotFoundError at every entry point, for %s',
    async (bad) => {
      const recording = await opened();
      for (const [name, select] of ENTRY_POINTS) {
        const thrown = await thrownBy(() => select(recording, [bad]));
        expect(thrown, name).toBeInstanceOf(EdfChannelNotFoundError);
        const error = thrown as EdfChannelNotFoundError;
        // An EdfError: the caller asked about a channel, and the file is what says there isn't one.
        expect(isEdfError(error), name).toBe(true);
        expect(error.selector, name).toBe(bad);
        expect(error.availableLabels, name).toEqual(['Fp1', 'Fp2', 'EDF Annotations']);
        expect(error.message, name).toMatch(/Next:/);
      }
    },
  );
});

describe('an index that names the annotations channel', () => {
  it('is a plain RangeError at every entry point, not an EdfError', async () => {
    const recording = await opened();
    for (const [name, select] of ENTRY_POINTS) {
      const thrown = await thrownBy(() => select(recording, [ANNOTATIONS_INDEX]));
      expect(thrown, name).toBeInstanceOf(RangeError);
      expect(thrown, name).not.toBeInstanceOf(EdfChannelNotFoundError);
      // The split a caller writes two `catch` blocks around.
      expect(isEdfError(thrown), name).toBe(false);
      expect((thrown as Error).message, name).toContain('annotations channel');
      expect((thrown as Error).message, name).toMatch(/Next:/);
    }
  });

  it('is the same refusal whether it is alone or mixed with real signals', async () => {
    const recording = await opened();
    for (const [name, select] of ENTRY_POINTS) {
      const alone = await thrownBy(() => select(recording, [ANNOTATIONS_INDEX]));
      const mixed = await thrownBy(() => select(recording, [0, ANNOTATIONS_INDEX]));
      expect((mixed as Error)?.message, name).toBe((alone as Error)?.message);
    }
  });
});

describe('a selection that is legal but odd', () => {
  it('drops a repeated index at every entry point', async () => {
    const recording = await opened();
    for (const [name, select] of ENTRY_POINTS) {
      expect(await select(recording, [0, 0]), name).toEqual([0]);
      expect(await select(recording, [1, 0, 1]), name).toEqual([1, 0]);
    }
  });

  it('returns the order it was given, at every entry point', async () => {
    const recording = await opened();
    for (const [name, select] of ENTRY_POINTS) {
      expect(await select(recording, [1, 0]), name).toEqual([1, 0]);
      expect(await select(recording, [0, 1]), name).toEqual([0, 1]);
    }
  });

  it('accepts an empty selection and returns no signals, rather than all of them', async () => {
    const recording = await opened();
    for (const [name, select] of ENTRY_POINTS) {
      expect(await select(recording, []), name).toEqual([]);
    }
  });
});
