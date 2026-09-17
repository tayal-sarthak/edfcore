/**
 * `formatAnnotations` given an array of something else.
 *
 * 0.6.95 gave it a guard, and said why one is needed: `''` is this function's "no events", so a
 * wrong argument must not be able to produce it. The guard tests `Array.isArray`.
 *
 * An array of the wrong thing passes. The first field the listing reads is
 * `onsetTicksFromFirstRecord`, a BigInt, so what came back was V8's `Cannot mix BigInt and other
 * types, use explicit conversions` — a sentence about arithmetic, out of a printer, naming no
 * argument and carrying no `Next:` clause.
 *
 * `header.diagnostics` is the list that gets passed. It is the other array a reader holds after
 * opening a file, `formatDiagnostics` sits beside this call in the barrel, and the two take the same
 * shape of argument with the same shape of options — so the pair is easy to cross.
 *
 * Both siblings already close this: `formatDiagnostics` in 0.6.160 and `summarizeDiagnostics` in
 * 0.6.168, each checking the one field its own rows must carry. This is the third and last of the
 * three, and it checks the onset.
 */

import { describe, expect, it } from 'vitest';
import { formatAnnotations } from '../../src/format-annotations.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import type { EdfAnnotation, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

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

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

describe('an array whose rows are not events', () => {
  it('is refused rather than dying on the onset arithmetic', async () => {
    const recording = await opened();
    // Every conforming EDF file carries DATE_CLIPPED_TO_1985_2084, so this list is never empty.
    expect(recording.header.diagnostics.length).toBeGreaterThan(0);
    let thrown: Error | undefined;
    try {
      formatAnnotations(recording.header.diagnostics as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown?.message).not.toContain('Cannot mix BigInt');
    expect(thrown?.message).toContain('carries no onset');
    expect(thrown?.message).toContain('Next:');
  });

  it('names the row, and the printer the diagnostics belong to', async () => {
    const recording = await opened();
    expect(() => formatAnnotations(recording.header.diagnostics as never)).toThrow(
      /the value at 0/,
    );
    expect(() => formatAnnotations(recording.header.diagnostics as never)).toThrow(
      /formatDiagnostics\(\)/,
    );
  });

  it('is refused for the other arrays a reader holds', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    expect(() => formatAnnotations(chunks as never)).toThrow(/carries no onset/);
    expect(() => formatAnnotations(chunks[0]?.signals as never)).toThrow(/carries no onset/);
    expect(() => formatAnnotations(recording.header.signals as never)).toThrow(/carries no onset/);
  });

  it('names the position of the first row that is wrong, not the first row', async () => {
    const recording = await opened();
    const events = (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
    expect(events.length).toBeGreaterThan(1);
    const mixed = [events[0] as EdfAnnotation, { text: 'not an event' }];
    expect(() => formatAnnotations(mixed as never)).toThrow(/the value at 1/);
  });
});

describe('the events themselves', () => {
  it('still print, one row each', async () => {
    const recording = await opened();
    const events = (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
    const text = formatAnnotations(events);
    expect(text.split('\n').length).toBe(events.length);
    expect(text).toContain('event 0');
  });

  it('still honour maxItems, and only check the rows they print', async () => {
    const recording = await opened();
    const events = (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
    const text = formatAnnotations(events, { maxItems: 1 });
    expect(text).toContain('event 0');
    expect(text).toContain('more');
  });

  it("still return '' for a recording that has none, which 0.6.95 protects", () => {
    expect(formatAnnotations([])).toBe('');
  });

  it('still refuse the result object rather than the list', async () => {
    const recording = await opened();
    const result = await readAnnotations(recording, { start: 0, count: 4 });
    expect(() => formatAnnotations(result as never)).toThrow(/not an array/);
  });
});
