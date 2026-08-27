/**
 * `raw` quotes the bytes `byteOffset` names, on every diagnostic that carries both.
 *
 * `EdfDiagnostic.raw` is documented as "those bytes as text, exactly as written including
 * padding" — the bytes AT the offset the same diagnostic reports. It is the only evidence a
 * reader has that the diagnosis is about the field they are looking at, and it is what a
 * consumer writing their own report prints beside the offset. When the two disagree the
 * diagnostic is worse than silent: it points at one place and quotes another, and both look
 * right on their own.
 *
 * That has gone wrong three times, in three different ways, and each was found by eye:
 *
 *  - 0.3.26: `NON_ASCII_HEADER_FIELD` quoted bytes that contradicted its own claim.
 *  - 0.3.68: a TAL diagnostic put the ESCAPED message preview in `raw`, so four bytes came back
 *    as a 13-character string spelling `\x01` where the byte was 0x01.
 *  - 0.3.73: `PARTIAL_FINAL_RECORD` points into the DATA section and had inherited the
 *    record-count FIELD's eight bytes, so the rendered block asserted that the bytes at the
 *    printed data offset read `"-1      "`. They are the tail of a truncated record.
 *
 * Nothing checked the pair itself, which is why the same defect could appear three times. This
 * does: damage a file at random, parse it, and for every diagnostic with a `raw` and an offset,
 * read the file at that offset and compare. Both sides are checked because they derive the
 * offset differently — a header field's comes from a fixed table, and a TAL's is
 * `headerByteLength + recordIndex * recordByteLength + signal.recordByteOffset` recomputed from
 * the record buffer's own position, which is exactly the arithmetic 0.3.73 got wrong elsewhere.
 *
 * The counts at the end are what stop a green run from being a vacuous one: a change that stops
 * producing diagnostics under damage would otherwise satisfy every case above by having no cases.
 *
 * What this does NOT check: that the diagnostic is the RIGHT one for the damage, or that
 * `byteLength` covers the whole field rather than part of it. Those are the per-code tests. This
 * is the one claim every code makes at once.
 *
 * The seeds are constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';
import { parseHeader } from '../../src/header/parse.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import type { EdfDiagnostic, EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x4edf;

/** A patch is one byte written somewhere, which is the smallest damage that changes a field. */
const PATCHES = fc.array(fc.tuple(fc.nat({ max: 4095 }), fc.nat({ max: 255 })), {
  minLength: 1,
  maxLength: 8,
});

function damaged(clean: Uint8Array, patches: readonly (readonly [number, number])[], from: number) {
  const bytes = Uint8Array.from(clean);
  const span = bytes.length - from;
  for (const [where, value] of patches) {
    // Modulo rather than a filter, so every generated patch lands inside the region under test
    // instead of most of them falling off the end and testing nothing.
    if (span > 0) bytes[from + (where % span)] = value;
  }
  return bytes;
}

/** Every diagnostic that quotes bytes, checked against the file it quotes them from. */
function checkQuotes(bytes: Uint8Array, diagnostics: readonly EdfDiagnostic[], seen: Set<string>) {
  let checked = 0;
  for (const diagnostic of diagnostics) {
    seen.add(diagnostic.code);
    const { raw, byteOffset, byteLength } = diagnostic;
    if (raw === undefined || byteOffset === undefined || byteLength === undefined) continue;
    const there = decodeHeaderLatin1(bytes.subarray(byteOffset, byteOffset + byteLength));
    expect(
      there,
      `${diagnostic.code} quotes ${JSON.stringify(raw)} but bytes ` +
        `${byteOffset}..${byteOffset + byteLength} are ${JSON.stringify(there)}`,
    ).toBe(raw);
    checked += 1;
  }
  return checked;
}

describe('a header diagnostic quotes the bytes it points at', () => {
  const cleanFiles: readonly Uint8Array[] = [
    buildEdf({
      format: 'EDF',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    }),
    buildEdf({
      format: 'BDF',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    }),
  ];

  const seen = new Set<string>();
  let checked = 0;

  it('holds for every damaged header the parser still accepts', () => {
    fc.assert(
      fc.property(fc.nat({ max: cleanFiles.length - 1 }), PATCHES, (which, patches) => {
        const clean = cleanFiles[which];
        if (clean === undefined) throw new Error('no fixture');
        // From byte 0: the damage is meant to land in the header, which is what carries fields.
        const bytes = damaged(clean, patches, 0);
        let header: EdfHeader;
        try {
          header = parseHeader(bytes, bytes.byteLength);
        } catch {
          // A fatal defect throws instead of diagnosing, and has no diagnostics to check.
          return;
        }
        checked += checkQuotes(bytes, header.diagnostics, seen);
      }),
      { numRuns: 3000, seed: SEED },
    );
  });

  it('checked enough diagnostics, across enough codes, for that to mean something', () => {
    expect(checked).toBeGreaterThan(1000);
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});

describe('a TAL diagnostic quotes the bytes it points at', () => {
  // The TAL side recomputes a FILE offset while slicing from a RECORD BUFFER, so the two can
  // disagree by a whole header or by one signal's offset within the record without either
  // number looking wrong. Four records and a data signal ahead of the annotations channel, so
  // both terms of that sum are non-zero and a dropped one is visible.
  const clean = buildEdf({
    format: 'EDF',
    plus: 'D',
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 24,
        tals: (recordIndex) => [{ onset: recordIndex + 0.5, texts: ['ping'] }],
      },
    ],
  });

  const seen = new Set<string>();
  let checked = 0;

  it('holds for every damaged annotation region', () => {
    const reference = parseHeader(clean, clean.byteLength);
    fc.assert(
      fc.property(PATCHES, (patches) => {
        // From the end of the header: the damage is meant to land in the data records.
        const bytes = damaged(clean, patches, reference.headerByteLength);
        let header: EdfHeader;
        try {
          header = parseHeader(bytes, bytes.byteLength);
        } catch {
          return;
        }
        const records = { start: 0, count: header.recordCount };
        const recordBytes = bytes.subarray(
          header.headerByteLength,
          header.headerByteLength + records.count * header.recordByteLength,
        );
        checked += checkQuotes(
          bytes,
          decodeAnnotations(header, recordBytes, records).diagnostics,
          seen,
        );
      }),
      { numRuns: 2000, seed: SEED },
    );
  });

  it('checked enough diagnostics, across enough codes, for that to mean something', () => {
    expect(checked).toBeGreaterThan(1000);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
