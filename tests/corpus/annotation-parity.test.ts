/**
 * EDF+ annotations, checked against pyEDFlib.
 *
 * The scaling harness checks arithmetic. This checks the other thing edfcore has got wrong more
 * than once: WHICH AXIS an onset is on. Six releases — 0.1.4, 0.2.10, 0.2.18, 0.2.19, 0.2.28 and
 * the sample-grid contract in 0.2.32 — were variants of "one function used the nominal grid while
 * the rest used the record's true onset", and every one of them was found by comparing edfcore
 * against edfcore. `tests/property/timebase.test.ts` makes that internal agreement a hard
 * invariant; this makes it an EXTERNAL one, which is a different kind of evidence: a shared
 * misreading of the format would satisfy the first and fail here.
 *
 * The fixture is written by pyEDFlib and read back by pyEDFlib, so the goldens are its answer, not
 * ours. `writeAnnotation` silently drops an event that does not fit the region it sized, so the
 * generator refuses to record fewer than it wrote — otherwise this file would compare an
 * incomplete set and pass while doing it.
 *
 * Regenerate:
 *     .venv/bin/python scripts/golden/generate-annotations.py
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';

interface GoldenAnnotation {
  readonly onsetSeconds: number;
  readonly onsetBits: string;
  /** pyEDFlib writes -1 for "this event has no duration"; EDF+ omits the field entirely. */
  readonly durationSeconds: number;
  readonly text: string;
}

interface Golden {
  readonly file: string;
  readonly producer: string;
  readonly recordDurationSeconds: number;
  readonly recordCount: number;
  readonly annotations: readonly GoldenAnnotation[];
}

function load(): { golden: Golden; bytes: Uint8Array } {
  const dir = (file: string): string => fileURLToPath(new URL(`./golden/${file}`, import.meta.url));
  const golden = JSON.parse(readFileSync(dir('edf-annotations.json'), 'utf8')) as Golden;
  return { golden, bytes: new Uint8Array(readFileSync(dir(golden.file))) };
}

function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

async function readAll() {
  const { golden, bytes } = load();
  const recording = await openEdf(byteSource(bytes));
  const { annotations, diagnostics } = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  return { golden, recording, annotations, diagnostics };
}

describe('the annotation goldens are pyEDFlib output', () => {
  it('names its producer and carries every event that was written', () => {
    const { golden } = load();
    expect(golden.producer).toMatch(/^pyedflib \d/);
    expect(golden.annotations.length).toBe(5);
    // Distinct onsets, so an off-by-one in the comparison could not pass by coincidence.
    expect(new Set(golden.annotations.map((a) => a.onsetSeconds)).size).toBe(5);
  });
});

describe('edfcore and pyEDFlib read the same events', () => {
  it('finds the same texts, in the same order', async () => {
    const { golden, annotations } = await readAll();
    expect(annotations.map((a) => a.text)).toEqual(golden.annotations.map((a) => a.text));
  });

  it('puts every event at the same onset, to the tick', async () => {
    // The axis question, answered by someone else. pyEDFlib reports seconds from the recording
    // start; `onsetSecondsFromFirstRecord` is edfcore's name for that same axis.
    const { golden, annotations } = await readAll();
    for (const [index, expected] of golden.annotations.entries()) {
      const actual = annotations[index];
      const want = fromBits(expected.onsetBits);
      expect(actual?.onsetSecondsFromFirstRecord, expected.text).toBe(want);
      // And the exact field agrees with the float one, so the tick form is on the same axis.
      expect(actual?.onsetTicksFromFirstRecord, expected.text).toBe(
        BigInt(Math.round(want * Number(TICKS_PER_SECOND))),
      );
    }
  });

  it('agrees about which events have a duration and which do not', async () => {
    // pyEDFlib spells "no duration" as -1 because its API returns a float array. EDF+ spells it by
    // omitting the field, and edfcore spells it `undefined` — the distinction 0.2.20 turned on.
    const { golden, annotations } = await readAll();
    for (const [index, expected] of golden.annotations.entries()) {
      const actual = annotations[index];
      if (expected.durationSeconds < 0) {
        expect(actual?.durationSeconds, expected.text).toBeUndefined();
      } else {
        expect(actual?.durationSeconds, expected.text).toBe(expected.durationSeconds);
      }
    }
  });

  it('reports no defect in a file a reference writer produced', async () => {
    // A conformant file from another implementation is the strongest available check that
    // edfcore's TAL grammar is not merely self-consistent.
    const { diagnostics, recording } = await readAll();
    expect(diagnostics.map((d) => d.code)).toEqual([]);
    expect(recording.header.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('the query layer lands each event in the window that holds it', () => {
  it('loses no event across a partition, and repeats only the ones with a duration', async () => {
    // The end-to-end version of the axis claim: onsets from one library, windows from the other's
    // own record geometry.
    //
    // "Exactly once" is the wrong property and was the first thing written here. An annotation is
    // returned when it OVERLAPS a window — containment would return nothing for a window inside a
    // 30-second sleep epoch, which is the case the rule exists for — so `Sleep stage W` appears in
    // every window it spans and appearing once would be the bug. Instantaneous events are the ones
    // that must appear exactly once.
    const { golden, annotations, recording } = await readAll();
    const windows = Math.ceil(recording.timeline.spanSeconds);

    const seen = Array.from({ length: windows }, (_, i) =>
      filterAnnotationsByTime(annotations, { startSeconds: i, durationSeconds: 1 }),
    ).flat();

    // Nothing is lost.
    expect(new Set(seen.map((a) => a.text))).toEqual(
      new Set(golden.annotations.map((a) => a.text)),
    );

    const occurrences = (text: string) => seen.filter((a) => a.text === text).length;
    for (const expected of golden.annotations) {
      if (expected.durationSeconds < 0) {
        expect(occurrences(expected.text), `${expected.text} is instantaneous`).toBe(1);
      } else {
        // A durationed event covers ceil-ish many one-second windows from its onset, bounded by
        // the end of the recording. Asserting "more than one" for the 30 s epoch and "one" for the
        // 0.25 s one is the real distinction, and it comes from the golden's own duration.
        const covered = Math.min(
          windows - Math.floor(expected.onsetSeconds),
          Math.ceil(expected.onsetSeconds + expected.durationSeconds) -
            Math.floor(expected.onsetSeconds),
        );
        expect(
          occurrences(expected.text),
          `${expected.text} spans ${expected.durationSeconds}s`,
        ).toBe(covered);
      }
    }
  });

  it('places each event in the window pyEDFlib own onset implies', async () => {
    const { golden, annotations } = await readAll();
    for (const expected of golden.annotations) {
      const window = Math.floor(expected.onsetSeconds);
      const inWindow = filterAnnotationsByTime(annotations, {
        startSeconds: window,
        durationSeconds: 1,
      });
      expect(
        inWindow.map((a) => a.text),
        `${expected.text} at ${expected.onsetSeconds}`,
      ).toContain(expected.text);
    }
  });
});
