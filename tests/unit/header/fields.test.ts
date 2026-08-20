/**
 * The ten fixed header fields, read directly rather than through a whole parse.
 *
 * `header/fields.ts` is the sole owner of where each field lives and which diagnostic a field that
 * fails its grammar deserves, and no test imported it: every function here ran only as a step
 * inside `parseHeader`, which means each one was covered by whichever inputs some larger fixture
 * happened to produce. The offsets are the part that cannot be checked that way at all — a field
 * read from the wrong offset still parses, it just parses the neighbouring field's bytes.
 *
 * The offsets and widths are the EDF specification's, not this project's, so they are written out
 * here from the spec rather than imported from `constants.ts`. Importing them would compare the
 * table with itself; the two must agree because both describe a format neither of them defines.
 */

import { describe, expect, it } from 'vitest';
import { HEADER_FIELDS } from '../../../src/constants.js';
import {
  describeFixedField,
  fixedFieldSpecReference,
  readRawHeaderFields,
} from '../../../src/header/fields.js';

/** EDF specification, header record: the fixed 256 bytes, in order, with their widths. */
const SPEC: ReadonlyArray<readonly [string, number, number]> = [
  ['version', 0, 8],
  ['patientId', 8, 80],
  ['recordingId', 88, 80],
  ['startDate', 168, 8],
  ['startTime', 176, 8],
  ['headerByteLength', 184, 8],
  ['reserved', 192, 44],
  ['recordCount', 236, 8],
  ['recordDuration', 244, 8],
  ['signalCount', 252, 4],
];

describe('the field table is the specification', () => {
  it.each(SPEC)('%s sits at byte %d and is %d wide', (name, offset, length) => {
    const field = HEADER_FIELDS[name as keyof typeof HEADER_FIELDS];
    expect(field.offset).toBe(offset);
    expect(field.length).toBe(length);
  });

  it('accounts for all 256 bytes with no gap and no overlap', () => {
    // The property that makes a wrong offset visible: the fields tile the fixed header exactly.
    let next = 0;
    for (const [name, offset, length] of SPEC) {
      expect(offset, `${name} does not start where the previous field ends`).toBe(next);
      next = offset + length;
    }
    expect(next).toBe(256);
  });
});

describe('readRawHeaderFields', () => {
  /** A fixed header whose every field is filled with a distinct letter. */
  function marked(): Uint8Array {
    const bytes = new Uint8Array(256).fill(0x20);
    SPEC.forEach(([, offset, length], index) => {
      bytes.fill('abcdefghij'.charCodeAt(index), offset, offset + length);
    });
    return bytes;
  }

  it('takes each field from its own bytes', () => {
    // Distinct fill per field, so reading one at another's offset is visible rather than plausible.
    const raw = readRawHeaderFields(marked()) as unknown as Record<string, string>;
    SPEC.forEach(([name, , length], index) => {
      expect(raw[name], `${name} was read from the wrong offset`).toBe(
        'abcdefghij'[index]?.repeat(length),
      );
    });
  });

  it('keeps the bytes verbatim, padding included', () => {
    // "Raw first, always" — a numeric field that failed to parse is exactly when the caller needs
    // the bytes as written, so nothing here is trimmed.
    const bytes = new Uint8Array(256).fill(0x20);
    for (const [index, code] of [...'0       '].entries()) bytes[index] = code.charCodeAt(0);
    const raw = readRawHeaderFields(bytes);
    expect(raw.version).toBe('0       ');
    expect(raw.version).toHaveLength(8);
  });

  it('decodes as Latin-1, so byte 0x80 survives as U+0080', () => {
    const bytes = new Uint8Array(256).fill(0x20);
    bytes[8] = 0x80;
    expect(readRawHeaderFields(bytes).patientId.codePointAt(0)).toBe(0x80);
  });
});

describe('the field descriptions a diagnostic quotes', () => {
  it.each(SPEC.map(([name]) => name))('%s names its offset and width', (name) => {
    const described = describeFixedField(name as keyof typeof HEADER_FIELDS);
    const field = HEADER_FIELDS[name as keyof typeof HEADER_FIELDS];
    expect(described).toContain(String(field.offset));
    expect(described).toContain(String(field.length));
  });

  it.each(SPEC.map(([name]) => name))('%s cites the specification', (name) => {
    // Every diagnostic carries the clause it comes from; an empty citation is worse than none,
    // because it reads as though the rule were edfcore's own.
    expect(fixedFieldSpecReference(name as keyof typeof HEADER_FIELDS).length).toBeGreaterThan(10);
  });
});
