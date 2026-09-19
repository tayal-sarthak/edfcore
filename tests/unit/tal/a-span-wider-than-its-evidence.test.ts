/**
 * `byteOffset` + `byteLength` naming more bytes than `raw` holds.
 *
 * Every diagnostic in this package satisfies one invariant: `raw` is the bytes at
 * `byteOffset..byteOffset + byteLength`, decoded Latin-1. It is what makes the pair worth carrying —
 * a reader goes and looks at exactly those bytes — and `reportTimekeepingDefect` states it outright,
 * having been fixed for breaking it: `EdfDiagnostic.raw` is "those bytes as text, exactly as written
 * including padding", so a narrow `raw` beside a wide span "contradicted the field's own meaning".
 *
 * The two annotation-region reports still broke it. `raw` and `rawBytes` are capped at 48 bytes —
 * deliberately, because "a diagnostic must not carry an unbounded copy of a record" — and the span
 * was the whole region. So a 70-byte unterminated region reported `byteLength: 70` beside a `raw` of
 * 48 characters, and a reader slicing the file by those two numbers saw bytes the diagnostic never
 * quoted, with nothing saying which half was which.
 *
 * The span now describes the evidence. The region's own width is `signal.recordByteLength`, which
 * the header already carries, and each message says what it is quoting — "Bytes at that offset",
 * "Region starts with" — with the `...` the preview appends when it cut.
 */

import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../../src/bytes/latin1.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfDiagnostic } from '../../../src/types.js';
import { validateRecording } from '../../../src/validate.js';
import { setSignalField } from '../../support/corrupt.js';
import { buildEdf } from '../../support/writer.js';

/** A region wide enough that the 48-byte cap bites. */
const BASE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EMG Chin', samplesPerRecord: 4 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** Zeroing a data signal's width shifts the regions, so the TAL parse reports on them. */
const DAMAGED = setSignalField(BASE, 3, 0, 'samplesPerRecord', '0       ');

async function everyDiagnostic(bytes: Uint8Array): Promise<readonly EdfDiagnostic[]> {
  const recording = await openEdf(byteSource(bytes));
  const report = await validateRecording(recording, { scanSamples: true });
  return [
    ...recording.header.diagnostics,
    ...recording.timeline.diagnostics,
    ...report.diagnostics,
  ];
}

const withBytes = (all: readonly EdfDiagnostic[]): readonly EdfDiagnostic[] =>
  all.filter(
    (one) => one.byteOffset !== undefined && one.byteLength !== undefined && one.raw !== undefined,
  );

describe('every diagnostic that names a byte range', () => {
  it('quotes exactly the bytes it names, on a damaged file', async () => {
    const all = withBytes(await everyDiagnostic(DAMAGED));
    expect(all.length).toBeGreaterThan(0);
    for (const one of all) {
      const at = decodeHeaderLatin1(
        DAMAGED.subarray(
          one.byteOffset as number,
          (one.byteOffset as number) + (one.byteLength as number),
        ),
      );
      expect(at, `${one.code} at ${one.byteOffset}+${one.byteLength}`).toBe(one.raw);
    }
  });

  it('quotes exactly the bytes it names, on a conforming one', async () => {
    const all = withBytes(await everyDiagnostic(BASE));
    for (const one of all) {
      const at = decodeHeaderLatin1(
        BASE.subarray(
          one.byteOffset as number,
          (one.byteOffset as number) + (one.byteLength as number),
        ),
      );
      expect(at, one.code).toBe(one.raw);
    }
  });

  it('carries rawBytes of exactly that length too', async () => {
    const all = (await everyDiagnostic(DAMAGED)).filter((one) => one.rawBytes !== undefined);
    expect(all.length).toBeGreaterThan(0);
    for (const one of all) {
      expect(one.rawBytes?.byteLength, one.code).toBe(one.byteLength);
    }
  });
});

describe('the region reports that were wider than their evidence', () => {
  it('no longer name more than the 48-byte cap allows them to quote', async () => {
    const all = withBytes(await everyDiagnostic(DAMAGED));
    const regions = all.filter((one) => one.field === 'annotation region');
    expect(regions.length).toBeGreaterThan(0);
    for (const one of regions) {
      expect(one.byteLength, one.code).toBeLessThanOrEqual(48);
      expect(one.raw?.length, one.code).toBe(one.byteLength);
    }
  });

  it('still say in prose what they are quoting from', async () => {
    const all = await everyDiagnostic(DAMAGED);
    const regions = all.filter((one) => one.field === 'annotation region');
    for (const one of regions) {
      expect(one.message).toContain('Bytes at that offset');
    }
  });

  it('still name the record and the signal the region belongs to', async () => {
    const all = await everyDiagnostic(DAMAGED);
    const regions = all.filter((one) => one.field === 'annotation region');
    for (const one of regions) {
      expect(typeof one.signalIndex).toBe('number');
      expect(typeof one.recordIndex).toBe('number');
    }
  });
});
