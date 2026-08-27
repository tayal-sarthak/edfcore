/**
 * "Anything checkable against the file is exposed twice."
 *
 * The second convention on `api-types.md`, in bold above every table: a parsed value and the raw
 * bytes it came from, both on the object, with the padding intact. The reason it is a convention
 * rather than a nicety is in the sentence after it — "A header field that disagrees with what
 * edfcore made of it is what you need to see when a file misbehaves" — so the raw side is the
 * evidence a bug report is written from, and evidence that is not the file's own bytes is worse
 * than none.
 *
 * `type-tables.test.ts` checks the raw interfaces list every field. Individual tests quote a raw
 * value here and there. What nothing checked is the convention itself: that every one of the ten
 * fixed fields and the ten per-signal fields, on every signal, is exactly the bytes the layout
 * puts at that offset, decoded the way the header is decoded and not trimmed on the way out.
 *
 * The per-signal half is where a mistake is easy and invisible. The block is FIELD-major, so a
 * signal's ten fields are ten different places in the header, each `256 + ns * before + i * width`
 * — and reading one field from the wrong signal's slot produces a plausible string rather than an
 * error. That is the layout bug the format is famous for, and on the raw side it would show up as
 * evidence pointing at a neighbour's bytes.
 *
 * The fixture is a three-signal file whose every field is a different length from its neighbours',
 * so no misread can land on an identical value, and whose values are short enough that every field
 * carries visible padding. Trimming anywhere on the raw path would strip it.
 *
 * What this does NOT check: that the PARSED value is the right reading of those bytes. That is
 * every other test in the suite. This checks only that the second copy is the file.
 */

import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';
import { HEADER_FIELDS, SIGNAL_FIELD_WIDTHS } from '../../src/constants.js';
import { parseHeader } from '../../src/header/parse.js';
import { signalFieldOffset } from '../../src/header/signals.js';
import type { EdfRawHeaderFields, EdfRawSignalFields } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PROSE = (DOCS_PAGES.get('api-types.md') ?? '').replace(/\s+/g, ' ');

// Three signals, each field a different length from the others', and every value short enough to
// leave padding in its field.
const BYTES = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  patientId: 'X F 01-JAN-1951 Subject',
  startDate: '02.08.51',
  startTime: '09.30.00',
  signals: [
    {
      label: 'Fp1',
      samplesPerRecord: 8,
      transducerType: 'AgAgCl',
      physicalDimension: 'uV',
      prefiltering: 'HP:0.1Hz',
      physicalMinimum: -500,
      physicalMaximum: 500,
      digitalMinimum: -2048,
      digitalMaximum: 2047,
    },
    {
      label: 'Resp o',
      samplesPerRecord: 16,
      transducerType: 'Thermistor',
      physicalDimension: 'mV',
      prefiltering: 'LP:75Hz',
      physicalMinimum: -1,
      physicalMaximum: 3,
      digitalMinimum: -128,
      digitalMaximum: 127,
    },
    {
      label: 'Temp rectal',
      samplesPerRecord: 1,
      transducerType: 'Rectal probe',
      physicalDimension: 'degC',
      prefiltering: 'None',
      physicalMinimum: 34,
      physicalMaximum: 42,
      digitalMinimum: -32768,
      digitalMaximum: 32767,
    },
  ],
});
const HEADER = parseHeader(BYTES, BYTES.byteLength);

/** The bytes a field occupies, decoded the way the header is decoded. */
const bytesAt = (offset: number, length: number): string =>
  decodeHeaderLatin1(BYTES.subarray(offset, offset + length));

describe('the page still states the convention', () => {
  it('says a checkable value is exposed twice, with the padding intact', () => {
    expect(PROSE).toContain('**Anything checkable against the file is exposed twice**');
    expect(PROSE).toContain('with the padding intact');
  });
});

describe('every fixed header field', () => {
  it('is the bytes at the offset the layout puts it at', () => {
    const raw: EdfRawHeaderFields = HEADER.raw;
    for (const [field, position] of Object.entries(HEADER_FIELDS)) {
      const value = raw[field as keyof EdfRawHeaderFields];
      expect(value, `header.raw.${field}`).toBe(bytesAt(position.offset, position.length));
      expect(value, `header.raw.${field} is not its whole field`).toHaveLength(position.length);
    }
  });

  it('keeps padding that the parsed value does not, so the two really are two', () => {
    // If every raw field equalled its trimmed self the check above would pass on a trimmed
    // implementation, and the convention would be unenforced by it.
    expect(HEADER.raw.startDate).toBe('02.08.51');
    expect(HEADER.raw.patientId).toBe('X F 01-JAN-1951 Subject'.padEnd(80, ' '));
    expect(HEADER.raw.patientId).not.toBe(HEADER.raw.patientId.trim());
    expect(HEADER.raw.signalCount).toBe('3   ');
    expect(HEADER.raw.recordCount).toBe('2       ');
  });
});

describe('every per-signal field, on every signal', () => {
  it('is the bytes the field-major layout puts it at', () => {
    const signalCount = HEADER.signals.length;
    expect(signalCount).toBe(3);
    for (const signal of HEADER.signals) {
      const raw: EdfRawSignalFields = signal.raw;
      for (const [field, width] of Object.entries(SIGNAL_FIELD_WIDTHS)) {
        const offset = signalFieldOffset(
          field as keyof typeof SIGNAL_FIELD_WIDTHS,
          signalCount,
          signal.index,
        );
        const value = raw[field as keyof EdfRawSignalFields];
        expect(value, `signal ${signal.index} raw.${field}`).toBe(bytesAt(offset, width));
        expect(value, `signal ${signal.index} raw.${field} is not its whole field`).toHaveLength(
          width,
        );
      }
    }
  });

  it('reads each signal its own field and not a neighbour’s', () => {
    // The field-major layout is the format's famous bug: with `ns = 1` a struct-per-signal reader
    // and a field-major one agree, and they part company on every file with more than one channel.
    // Three distinct values per field is what makes a swap visible.
    expect(HEADER.signals.map((signal) => signal.raw.label.trimEnd())).toEqual([
      'Fp1',
      'Resp o',
      'Temp rectal',
    ]);
    expect(HEADER.signals.map((signal) => signal.raw.transducerType.trimEnd())).toEqual([
      'AgAgCl',
      'Thermistor',
      'Rectal probe',
    ]);
    expect(HEADER.signals.map((signal) => signal.raw.prefiltering.trimEnd())).toEqual([
      'HP:0.1Hz',
      'LP:75Hz',
      'None',
    ]);
    expect(HEADER.signals.map((signal) => signal.raw.samplesPerRecord.trimEnd())).toEqual([
      '8',
      '16',
      '1',
    ]);
    // Every raw field of every signal is padded, so a trimming implementation fails above rather
    // than passing on values that happen to fill their fields.
    for (const signal of HEADER.signals) {
      for (const value of Object.values(signal.raw)) {
        expect(value.endsWith(' '), `${signal.label} carries a field with no padding`).toBe(true);
      }
    }
  });
});
