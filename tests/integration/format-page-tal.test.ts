/**
 * The TAL grammar `edf-format.md` prints as ABNF, executed against the parser.
 *
 * That block is the page's definition of the annotations format, and it is five lines that decide
 * how every event in an EDF+ file is found:
 *
 *   region   = *TAL *%x00                     ; samplesPerRecord * bytesPerSample bytes
 *   TAL      = Onset [ %x15 Duration ] %x14 *( Text %x14 ) %x00
 *   Onset    = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]
 *   Duration = 1*DIGIT [ "." 1*DIGIT ]        ; never signed
 *   Text     = UTF-8, excluding %x00, %x14, %x15
 *
 * Two of those lines carry a rule the rest of the page then argues from, and neither had a check
 * that read the page. `Onset` is signed and `Duration` is not — the page says "never signed" in a
 * trailing comment, and `tal/ticks.ts` refuses a leading sign for the reason that a signed
 * duration means the field layout is not the one being read. And `Text` excludes exactly the three
 * structural bytes, which is what makes splitting the region before decoding safe.
 *
 * The UTF-8 claim underneath it — "every byte of a multi-byte UTF-8 sequence is at least `0x80`
 * and can never collide with one of them" — is the one this file proves outright rather than
 * quotes, because it is the reason the whole parse order is legal.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { parseSignedTicks, parseUnsignedTicks } from '../../src/tal/ticks.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { encodeTal, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('edf-format.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

/** The three bytes the page calls structural. */
const SEPARATOR = 0x15;
const TERMINATOR = 0x14;
const NUL = 0x00;

describe('the grammar block', () => {
  it('is still printed on the page, line for line', () => {
    expect(FLAT).toContain('region = *TAL *%x00');
    expect(FLAT).toContain('TAL = Onset [ %x15 Duration ] %x14 *( Text %x14 ) %x00');
    expect(FLAT).toContain('Onset = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]');
    expect(FLAT).toContain('Duration = 1*DIGIT [ "." 1*DIGIT ]');
    expect(FLAT).toContain('Text = UTF-8, excluding %x00, %x14, %x15');
  });

  it('names the three structural bytes and what each one does', () => {
    // "`0x15` separates an onset from an optional duration. `0x14` terminates the timestamp and
    //  each individual text. `0x00` terminates a TAL and pads out the rest of the region."
    expect(FLAT).toContain('Three structural bytes carry the whole grammar');
    for (const byte of [SEPARATOR, TERMINATOR, NUL]) {
      expect(FLAT).toContain(`\`0x${byte.toString(16).padStart(2, '0')}\``);
    }
  });
});

describe('the onset is signed and the duration is not', () => {
  it('requires the sign the Onset rule requires', () => {
    // `Onset = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]` — the sign is not optional.
    expect(parseSignedTicks('+1.5').ok).toBe(true);
    expect(parseSignedTicks('-1.5').ok).toBe(true);
    expect(parseSignedTicks('1.5').ok).toBe(false);
  });

  it('refuses the sign the Duration rule forbids', () => {
    // `Duration = 1*DIGIT [ "." 1*DIGIT ]        ; never signed`
    expect(FLAT).toContain('Duration = 1*DIGIT [ "." 1*DIGIT ] ; never signed');
    expect(parseUnsignedTicks('30').ok).toBe(true);
    expect(parseUnsignedTicks('30.25').ok).toBe(true);
    expect(parseUnsignedTicks('+30').ok).toBe(false);
    expect(parseUnsignedTicks('-30').ok).toBe(false);
  });

  it('parses onsets exactly, which is what the page says parseFloat would not', () => {
    // "Parsed digit by digit they are exact to the resolution you parse them into, and
    //  `parseFloat` is the first thing that makes them inexact." 0.1 + 0.2 is the standard
    //  witness; in ticks it is one integer.
    //
    // The page said "the only thing" until 0.6.44, and this assertion pinned it. It is not: the
    // grammar bounds the fraction at nothing and edfcore counts in 100 ns, so the eighth
    // fractional digit onward is dropped. `past-the-seventh-digit.test.ts` runs that half.
    expect(FLAT).toContain('`parseFloat` is the first thing that makes them inexact');
    const tenth = parseSignedTicks('+0.1');
    const fifth = parseSignedTicks('+0.2');
    expect(tenth.ok && fifth.ok).toBe(true);
    expect(tenth.ticks + fifth.ticks).toBe(parseSignedTicks('+0.3').ticks);
    // The float route does not close, which is the whole reason for the tick route.
    expect(Number.parseFloat('0.1') + Number.parseFloat('0.2')).not.toBe(0.3);
  });
});

describe('splitting before decoding', () => {
  it('is safe because no UTF-8 byte can be one of the three', () => {
    // "every byte of a multi-byte UTF-8 sequence is at least `0x80` and can never collide with
    //  one of them" — proved rather than quoted, over every code point that has an encoding.
    const encoder = new TextEncoder();
    let checked = 0;
    // Encoded in blocks rather than one code point at a time. UTF-8 is context-free, so the bytes
    // of a run of code points are the concatenation of each one's bytes — and 1.1 million calls to
    // `String.fromCodePoint` and `encode` took long enough to time out under a loaded suite, which
    // is a property of the loop rather than of the claim. Same 4,382,464 bytes, about a tenth of
    // the time, and no weakening: raising the timeout instead would have kept a five-second check
    // in a suite that runs it on every commit (0.4.332).
    const BLOCK = 0x10000;
    for (let start = 0x80; start <= 0x10ffff; start += BLOCK) {
      let run = '';
      for (
        let codePoint = start;
        codePoint < start + BLOCK && codePoint <= 0x10ffff;
        codePoint += 1
      ) {
        // The surrogate range has no encoding of its own.
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
        run += String.fromCodePoint(codePoint);
      }
      const bytes = encoder.encode(run);
      checked += bytes.length;
      for (const byte of bytes) {
        if (byte >= 0x80) continue;
        expect.fail(
          `a code point in [${start}, ${start + BLOCK}) encodes byte 0x${byte.toString(16)}`,
        );
      }
    }
    // Every code point above U+007F, so the claim is exhaustive rather than sampled.
    expect(checked).toBeGreaterThan(3_000_000);
  });

  it('keeps a non-ASCII annotation intact through a real file', async () => {
    // The failure the page describes is the other order: "decode the region to a string, then
    // split ... corrupts any annotation containing a non-ASCII character."
    const text = 'apnée — 呼吸 µV';
    const bytes = minimalEdfPlus({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [
        {
          samplesPerRecord: 60,
          tals: () => [{ onset: 0.5, texts: [text] }],
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 1 });
    expect(annotations.map((entry) => entry.text)).toContain(text);
  });

  it('encodes that text with no structural byte in it', () => {
    // The support writer builds the region from the specification, so this is the encoding side
    // of the same claim: a text run carries no 0x00, 0x14 or 0x15 of its own.
    const encoded = encodeTal({ onset: 0.5, texts: ['apnée — 呼吸 µV'] });
    const body = encoded.subarray(encoded.indexOf(TERMINATOR) + 1, encoded.length - 1);
    for (const byte of body.subarray(0, body.length - 1)) {
      expect([NUL, TERMINATOR, SEPARATOR]).not.toContain(byte);
    }
  });
});
