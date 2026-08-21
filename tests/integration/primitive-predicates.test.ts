/**
 * Three small pure functions on `api-primitives.md`, each documented with a claim worth holding.
 *
 * `decodeHeaderLatin1` is the one with teeth. The page does not merely say `TextDecoder` is
 * unused; it says why, with a measurement: on Node v24.4.0 the labels `latin1`, `iso-8859-1`,
 * `ascii` and `windows-1252` all report `encoding === 'windows-1252'` and decode `0x80` as U+0080,
 * while the WHATWG Encoding Standard mandates U+20AC for those labels. So the same header bytes
 * become different strings in Node and in a browser — a label that compares equal on a server and
 * not in a tab, from a file neither of them got wrong.
 *
 * `text-decoder-ban.test.ts` already forbids the call. This checks the behaviour the ban buys: the
 * identity map, at the byte the two disagree about.
 *
 * `formatStartTimeNaive` returns `undefined` for TWO conditions, and the second is the interesting
 * one. Without it a file whose starttime reads `23.59.60` came back as midnight — a wall-clock
 * instant the file never gave, and for a sleep study the most believable start there is.
 */

import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';
import { formatStartTimeNaive } from '../../src/header/dates.js';
import { isAnnotationLabel } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-primitives.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

describe('isAnnotationLabel', () => {
  it('answers what the page prints beside each call', () => {
    for (const [, argument = '', answer = ''] of PAGE.matchAll(
      /isAnnotationLabel\('([^']*)'\);\s*\/\/ (true|false)/g,
    )) {
      expect(isAnnotationLabel(argument), argument).toBe(answer === 'true');
    }
    // Both examples on the page, so the loop above is not empty.
    expect(FLAT).toContain("isAnnotationLabel('EDF Annotations ')");
  });

  it('accepts either reserved label for either family', () => {
    // "the label identifies the channel's **role**, and a BDF+ file written by an EDF+ library
    //  carries `'EDF Annotations'`."
    expect(isAnnotationLabel('EDF Annotations')).toBe(true);
    expect(isAnnotationLabel('BDF Annotations')).toBe(true);
  });

  it('matches on the trimmed text, case-sensitively', () => {
    expect(isAnnotationLabel('  EDF Annotations  ')).toBe(true);
    expect(isAnnotationLabel('edf annotations')).toBe(false);
    expect(isAnnotationLabel('EDF ANNOTATIONS')).toBe(false);
  });

  it('is the predicate the parser used to set `kind`', async () => {
    // "You rarely need this, since `signal.kind` already says `'annotations'`. It's the same
    //  predicate the parser uses."
    const { header } = await openEdf(
      byteSource(
        minimalEdfPlus({
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [{ samplesPerRecord: 30 }],
        }),
      ),
    );
    for (const signal of header.signals) {
      expect(isAnnotationLabel(signal.label), signal.label).toBe(signal.kind === 'annotations');
    }
  });
});

describe('decodeHeaderLatin1', () => {
  it('maps every byte to the code point of the same value', () => {
    // "byte `b` becomes code point U+00`b`, always."
    const all = new Uint8Array(256);
    for (let byte = 0; byte < 256; byte += 1) all[byte] = byte;
    const decoded = decodeHeaderLatin1(all);
    expect(decoded).toHaveLength(256);
    for (let byte = 0; byte < 256; byte += 1) {
      expect(decoded.codePointAt(byte), `0x${byte.toString(16)}`).toBe(byte);
    }
  });

  it('decodes the byte the encodings disagree about as the page says', () => {
    // The measurement the page makes: 0x80 is U+0080 here, and U+20AC under the WHATWG label.
    expect(FLAT).toContain('decode `0x80` as U+0080');
    expect(FLAT).toContain('mandates U+20AC for those labels');
    const decoded = decodeHeaderLatin1(Uint8Array.of(0x80));
    expect(decoded.codePointAt(0)).toBe(0x80);
    expect(decoded.codePointAt(0)).not.toBe(0x20ac);
  });

  it('does not trim or interpret', () => {
    // "No trimming, no interpretation."
    expect(decodeHeaderLatin1(Uint8Array.of(0x20, 0x30, 0x20))).toBe(' 0 ');
  });

  it('produces the version field the page prints', () => {
    // `decodeHeaderLatin1(bytes.subarray(0, 8));  // '0       '`
    const printed = /decodeHeaderLatin1\(bytes\.subarray\(0, 8\)\);\s*\/\/ '([^']*)'/.exec(PAGE);
    expect(printed).not.toBeNull();
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    expect(decodeHeaderLatin1(bytes.subarray(0, 8))).toBe(printed?.[1]);
  });
});

describe('formatStartTimeNaive', () => {
  const openAt = async (startDate: string, startTime: string) => {
    const { header } = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 1,
          recordDurationSeconds: 1,
          startDate,
          startTime,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
        }),
      ),
    );
    return header.startTime;
  };

  it('renders in the shape the page prints, with no zone designator', async () => {
    // The page's `'1951-08-02T09:00:00.000'` illustrates the FORMAT. It is not what `02.08.51`
    // resolves to: the two-digit year rule puts 00..84 in 2000..2084, so that field is 2051, as
    // `edf-format.md` says in as many words. Only a four-digit EDF+ `Startdate` can say 1951.
    expect(FLAT).toContain('There is no zone designator, because EDF has no zone');
    const printed = /Renders the recording start as `'([^']+)'`/.exec(FLAT);
    expect(printed).not.toBeNull();
    const shape = (printed?.[1] ?? '').replace(/\d/g, 'N');

    const rendered = formatStartTimeNaive(await openAt('02.08.51', '09.00.00'));
    expect(rendered?.replace(/\d/g, 'N')).toBe(shape);
    expect(rendered).toBe('2051-08-02T09:00:00.000');
    expect(rendered).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/);
  });

  it('always renders whole seconds, since the header stores nothing finer', async () => {
    // "The milliseconds are always `.000`. The header stores whole seconds."
    for (const clock of ['00.00.00', '09.00.00', '23.59.59']) {
      expect(formatStartTimeNaive(await openAt('02.08.51', clock))).toMatch(/\.000$/);
    }
  });

  it('returns undefined for the second condition, not only the first', async () => {
    // A starttime that fails its grammar. Without this branch the file came back as midnight —
    // an instant it never gave, and the most believable one for a sleep study.
    const startTime = await openAt('02.08.51', '23.59.60');
    expect(startTime.clockSource).toBe('none');
    expect(startTime.resolvedDate).toBeDefined();
    expect(formatStartTimeNaive(startTime)).toBeUndefined();
  });

  it('renders when both conditions are satisfied, so undefined means something', async () => {
    const startTime = await openAt('02.08.51', '09.00.00');
    expect(startTime.clockSource).not.toBe('none');
    expect(startTime.resolvedDate).toBeDefined();
    expect(formatStartTimeNaive(startTime)).toBeDefined();
  });
});
