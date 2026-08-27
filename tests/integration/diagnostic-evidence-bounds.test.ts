/**
 * A diagnostic points at bytes that exist, and names a signal and a record that exist.
 *
 * `byteOffset`/`byteLength` are how a consumer renders evidence: slice the file at the offset and
 * show what is there, the way `formatDiagnostics` does. A header field's offset comes from a
 * fixed table and is hard to get wrong. The interesting ones point into the DATA section, where
 * the offset is arithmetic — `headerByteLength + recordIndex * recordByteLength +
 * signal.recordByteOffset` for a TAL, the end of the last whole record for a truncated tail — and
 * the arithmetic is done in a module holding a buffer that starts somewhere else.
 *
 * Two of those carry no `raw`, deliberately: `PARTIAL_FINAL_RECORD` and `TRAILING_BYTES` point at
 * samples rather than at a field, and quoting samples as text says nothing. So the check that
 * `raw` and the offset agree — `diagnostic-raw-points-there.test.ts` — cannot reach them at all,
 * and their offsets are unverified by anything else. An offset past the end is not a crash:
 * `subarray` clamps, so the evidence block silently comes back short or empty and the reader
 * concludes the bytes were empty.
 *
 * `recordIndex` and `signalIndex` are the same kind of claim in a different currency. A TAL
 * diagnostic is reported per record from a loop over a buffer that may start at record 2, so the
 * index it reports is `records.start + position` and the buffer offset is `position` alone. Using
 * either where the other belongs is invisible on a read that starts at record 0, which is what
 * almost every fixture does — so the reads here start elsewhere on purpose.
 *
 * What this does NOT check: that the bytes at the offset are the right bytes. That is
 * `diagnostic-raw-points-there.test.ts`, for the diagnostics that carry text to compare.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import type { EdfDiagnostic, EdfHeader } from '../../src/types.js';
import { appendBytes, truncateBy } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x8b17;

const CLEAN = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    {
      samplesPerRecord: 24,
      tals: (recordIndex) => [{ onset: recordIndex + 0.5, texts: ['ping'] }],
    },
  ],
});
const REFERENCE = parseHeader(CLEAN, CLEAN.byteLength);

/** Every claim one diagnostic makes about where it is, checked against the file it came from. */
function checkBounds(
  bytes: Uint8Array,
  header: EdfHeader,
  diagnostic: EdfDiagnostic,
  records: { start: number; count: number },
): void {
  const { code, byteOffset, byteLength, signalIndex, recordIndex } = diagnostic;
  if (byteOffset !== undefined) {
    expect(byteOffset, `${code} offset`).toBeGreaterThanOrEqual(0);
    const end = byteOffset + (byteLength ?? 0);
    expect(
      end,
      `${code} points at bytes ${byteOffset}..${end} of a ${bytes.length}-byte file`,
    ).toBeLessThanOrEqual(bytes.length);
  }
  if (signalIndex !== undefined) {
    expect(signalIndex, `${code} signalIndex`).toBeGreaterThanOrEqual(0);
    expect(signalIndex, `${code} signalIndex`).toBeLessThan(header.signals.length);
  }
  if (recordIndex !== undefined) {
    expect(recordIndex, `${code} recordIndex below the range read`).toBeGreaterThanOrEqual(
      records.start,
    );
    expect(recordIndex, `${code} recordIndex past the range read`).toBeLessThan(
      records.start + records.count,
    );
  }
}

describe('a diagnostic from a damaged data section', () => {
  const seen = new Set<string>();
  let checked = 0;

  it('stays inside the file, and inside the records it was given', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat({ max: 4095 }), fc.nat({ max: 255 })), {
          minLength: 1,
          maxLength: 6,
        }),
        // A read that starts at record 0 cannot tell `records.start + position` from `position`.
        fc.nat({ max: 4 }),
        (patches, start) => {
          const bytes = Uint8Array.from(CLEAN);
          const span = bytes.length - REFERENCE.headerByteLength;
          for (const [where, value] of patches) {
            bytes[REFERENCE.headerByteLength + (where % span)] = value;
          }
          let header: EdfHeader;
          try {
            header = parseHeader(bytes, bytes.byteLength);
          } catch {
            return;
          }
          const count = Math.min(2, header.recordCount - start);
          if (count <= 0) return;
          const records = { start, count };
          const base = header.headerByteLength + start * header.recordByteLength;
          const recordBytes = bytes.subarray(base, base + count * header.recordByteLength);
          for (const diagnostic of decodeAnnotations(header, recordBytes, records).diagnostics) {
            checkBounds(bytes, header, diagnostic, records);
            seen.add(diagnostic.code);
            checked += 1;
          }
        },
      ),
      { numRuns: 2500, seed: SEED },
    );
  });

  it('checked enough of them, across enough codes, for that to mean something', () => {
    expect(checked).toBeGreaterThan(500);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});

describe('the two diagnostics that point at samples and quote nothing', () => {
  // Neither carries `raw` — they point at data, and quoting samples as text says nothing — so
  // nothing else in the suite can tell whether their offsets are inside the file.
  const wholeFile = { start: 0, count: REFERENCE.recordCount };

  it('keeps PARTIAL_FINAL_RECORD inside the fragment it describes', () => {
    for (const cut of [1, 7, REFERENCE.recordByteLength - 1]) {
      const bytes = truncateBy(CLEAN, cut);
      const header = parseHeader(bytes, bytes.byteLength);
      const partial = header.diagnostics.find((d) => d.code === 'PARTIAL_FINAL_RECORD');
      expect(partial, `no PARTIAL_FINAL_RECORD after cutting ${cut} bytes`).toBeDefined();
      if (partial === undefined) continue;
      checkBounds(bytes, header, partial, wholeFile);
      // The fragment is the whole of what is left after the last complete record, so the
      // diagnostic ends exactly at the end of the file.
      expect((partial.byteOffset ?? 0) + (partial.byteLength ?? 0)).toBe(bytes.length);
    }
  });

  it('keeps TRAILING_BYTES inside the bytes it describes', () => {
    for (const extra of [1, 9, REFERENCE.recordByteLength * 2]) {
      const bytes = appendBytes(CLEAN, new Uint8Array(extra).fill(0x7f));
      const header = parseHeader(bytes, bytes.byteLength);
      const trailing = header.diagnostics.find(
        (d) => d.code === 'TRAILING_BYTES' || d.code === 'PARTIAL_FINAL_RECORD',
      );
      expect(trailing, `nothing reported after appending ${extra} bytes`).toBeDefined();
      if (trailing === undefined) continue;
      checkBounds(bytes, header, trailing, wholeFile);
      expect((trailing.byteOffset ?? 0) + (trailing.byteLength ?? 0)).toBe(bytes.length);
    }
  });
});
