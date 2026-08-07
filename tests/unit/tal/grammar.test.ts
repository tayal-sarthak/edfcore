/**
 * The byte-level TAL state machine.
 *
 * ABNF under test (EDF+ specification 2.2.2, and DESIGN section 5, "TAL grammar"):
 *
 *   region   = *TAL *%x00                    ; exactly samplesPerRecord * bytesPerSample bytes
 *   TAL      = Onset [ %x15 Duration ] %x14 *( Text %x14 ) %x00
 *   Onset    = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]
 *   Duration = 1*DIGIT [ "." 1*DIGIT ]       ; never signed
 *   Text     = UTF-8, excluding %x00 %x14 %x15
 *
 * The two properties everything else depends on:
 *
 * 1. Parsing is HARD-BOUNDED to [regionStart, regionStart + regionBytes). The bytes past the
 *    bound are the next signal's samples.
 * 2. The region is split on the structural bytes FIRST and each text run is decoded LAST.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../../src/header/parse.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import {
  type ParsedTal,
  parseTalRegion,
  previewBytes,
  splitChannelLabel,
  TAL_PREVIEW_MAX_BYTES,
  type TalRegionParse,
} from '../../../src/tal/grammar.js';
import { patchBytes } from '../../support/corrupt.js';
import { encodeTal, minimalEdfPlus } from '../../support/writer.js';

// --------------------------------------------------------------------------
// Byte helpers. Nothing here imports from src/, so a shared misunderstanding
// between the fixture bytes and the parser cannot hide.
// --------------------------------------------------------------------------

/** 0x14 terminates the timestamp AND every text. 0x15 separates onset from duration. */
const MARK = 0x14;
const SEP = 0x15;
const NUL = 0x00;

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`ascii(): ${JSON.stringify(text)} is not one byte per char`);
    out[i] = code;
  }
  return out;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Content followed by NUL padding, exactly as a conforming writer lays a region out. */
function padRegion(sizeBytes: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const content = concat(...parts);
  if (content.length > sizeBytes) {
    throw new Error(`padRegion(): ${content.length} bytes of content do not fit in ${sizeBytes}`);
  }
  const out = new Uint8Array(sizeBytes);
  out.set(content, 0);
  return out;
}

/** Built rather than typed, so no invisible control character lands in this source file. */
function latin1(...byteValues: readonly number[]): string {
  return String.fromCharCode(...byteValues);
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${index}`);
  return item;
}

function codes(parse: TalRegionParse): readonly string[] {
  return parse.issues.map((issue) => issue.code);
}

function textsOf(tal: ParsedTal): readonly string[] {
  return tal.texts.map((run) => run.text);
}

describe('parsing is hard-bounded to the annotation region', () => {
  // A TAL with no terminating 0x00 anywhere inside its region. In a real file the bytes that
  // follow are the next signal's samples; every reader that scans for the 0x00 across the region
  // boundary turns those samples into annotation text, which is exactly how other JS EDF
  // libraries produce garbage annotations with plausible-looking onsets.
  const runaway = concat(ascii('+1.5'), Uint8Array.of(MARK), ascii('Seizure'), Uint8Array.of(MARK));

  it('discards a TAL that does not terminate inside the region, and never reads past the bound', () => {
    // The bytes after the region spell a complete, attractive TAL. None of it may appear.
    const phantom = concat(
      ascii('+9'),
      Uint8Array.of(MARK),
      ascii('PHANTOM'),
      Uint8Array.of(MARK),
      Uint8Array.of(NUL),
    );
    const bytes = concat(runaway, phantom);

    const parse = parseTalRegion(bytes, 0, runaway.length);

    expect(parse.tals).toEqual([]);
    expect(codes(parse)).toEqual(['TAL_TRUNCATED_AT_REGION_END']);
    const issue = at(parse.issues, 0);
    expect(issue.byteOffsetInRegion).toBe(0);
    expect(issue.byteLength).toBe(runaway.length);
    expect(issue.raw).not.toContain('PHANTOM');
    expect(issue.raw).not.toContain('+9');
  });

  it('does not consult the byte just past the bound even when it is the 0x00 it is looking for', () => {
    // The strongest available statement of the bound: a terminator sits at exactly regionBytes.
    // A parser that read one byte too far would find it and report a perfectly formed TAL.
    const bytes = concat(runaway, Uint8Array.of(NUL, NUL, NUL));

    const parse = parseTalRegion(bytes, 0, runaway.length);

    expect(parse.tals).toEqual([]);
    expect(codes(parse)).toEqual(['TAL_TRUNCATED_AT_REGION_END']);
  });

  it('reports offsets relative to the region, and ignores everything before regionStart', () => {
    // Sample bytes before the region, deliberately full of structural byte values: a 16-bit
    // sample of 0x1400 or 0x0000 is ordinary data and must not be mistaken for TAL structure.
    const samples = new Uint8Array(100);
    samples.fill(MARK);
    samples[50] = NUL;
    const bytes = concat(samples, runaway, ascii('+9'), Uint8Array.of(MARK, NUL));

    const parse = parseTalRegion(bytes, samples.length, runaway.length);

    expect(codes(parse)).toEqual(['TAL_TRUNCATED_AT_REGION_END']);
    expect(at(parse.issues, 0).byteOffsetInRegion).toBe(0);
  });

  it('produces byte-identical results wherever the same region sits in the buffer', () => {
    // A region's meaning cannot depend on where the record happens to start, and every offset a
    // caller sees back is region-relative. annotations.ts is what re-adds the file offset.
    const content = padRegion(
      32,
      encodeTal({ onset: '+0' }),
      encodeTal({ onset: '+0.5', texts: ['Spindle@@Fp1'] }),
    );
    const samples = new Uint8Array(100).fill(MARK);
    const atZero = parseTalRegion(content, 0, 32);
    const atOffset = parseTalRegion(concat(samples, content, samples), samples.length, 32);

    expect(atOffset).toEqual(atZero);
  });

  it('refuses a region that would leave the buffer rather than clamping it', () => {
    // A clamped region silently reads a shorter region than the header describes; a RangeError
    // says the header and the bytes disagree, which is the caller's bug to fix.
    const bytes = padRegion(16, encodeTal({ onset: '+0' }));
    expect(() => parseTalRegion(bytes, 0, bytes.length + 1)).toThrow(RangeError);
    expect(() => parseTalRegion(bytes, 8, 16)).toThrow(RangeError);
  });

  it('keeps every reported offset inside the region', () => {
    const bytes = concat(
      padRegion(24, encodeTal({ onset: '+1', texts: ['a'] }), ascii('junk')),
      ascii('+9'),
      Uint8Array.of(MARK, NUL),
    );

    const parse = parseTalRegion(bytes, 0, 24);

    for (const tal of parse.tals) {
      expect(tal.byteOffsetInRegion + tal.byteLength).toBeLessThanOrEqual(24);
    }
    for (const issue of parse.issues) {
      expect(issue.byteOffsetInRegion + issue.byteLength).toBeLessThanOrEqual(24);
    }
  });
});

describe('both timekeeping TAL shapes are accepted', () => {
  // DESIGN section 5: accept both `+t 0x14 0x14 0x00` (mandated) and `+t 0x14 0x00` (widespread).
  // Zero texts and one empty text are the same thing, because neither carries an event.
  const mandated = encodeTal({ onset: '+0' });
  const shorthand = encodeTal({ onset: '+0', shorthand: true });

  it('writes the two shapes as the byte strings the spec and the corpus actually use', () => {
    expect(Array.from(mandated)).toEqual([0x2b, 0x30, MARK, MARK, NUL]);
    expect(Array.from(shorthand)).toEqual([0x2b, 0x30, MARK, NUL]);
  });

  it('parses the mandated form as one empty text', () => {
    const parse = parseTalRegion(padRegion(16, mandated), 0, 16);
    expect(parse.issues).toEqual([]);
    const tal = at(parse.tals, 0);
    expect(tal.onsetTicks).toBe(0n);
    expect(tal.ordinal).toBe(0);
    expect(textsOf(tal)).toEqual(['']);
  });

  it('parses the shorthand as zero texts, with the same onset and no complaint from the grammar', () => {
    const parse = parseTalRegion(padRegion(16, shorthand), 0, 16);
    expect(parse.issues).toEqual([]);
    const tal = at(parse.tals, 0);
    expect(tal.onsetTicks).toBe(0n);
    expect(tal.ordinal).toBe(0);
    expect(textsOf(tal)).toEqual([]);
  });

  it('carries no event either way: every text is empty in both shapes', () => {
    const both = [mandated, shorthand].map((shape) => parseTalRegion(padRegion(16, shape), 0, 16));
    for (const parse of both) {
      expect(textsOf(at(parse.tals, 0)).join('')).toBe('');
    }
  });

  it('warns about the shorthand instead of rejecting the file, as EDFlib does', () => {
    // The disposition lives one layer up, in annotations.ts, because "this TAL is timekeeping" is
    // an EDF+ semantic rather than a byte-grammar fact. Pinned here too because the whole point
    // of accepting the shorthand is that the file stays readable.
    const file = minimalEdfPlus();
    const header = parseHeader(file, file.length);
    const annotationSignal = at(header.signals, at(header.annotationSignalIndices, 0));
    const regionOffset = header.headerByteLength + annotationSignal.recordByteOffset;
    // '+0' 0x14 0x14 0x00 becomes '+0' 0x14 0x00, with the freed byte returned to the padding.
    const patched = patchBytes(file, regionOffset, Uint8Array.of(0x2b, 0x30, MARK, NUL, NUL));
    const records = { start: 0, count: 1 };
    const recordBytes = patched.subarray(
      header.headerByteLength,
      header.headerByteLength + header.recordByteLength,
    );

    const result = decodeAnnotations(header, recordBytes, records);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'TIMEKEEPING_TAL_NONCONFORMANT',
    ]);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n]);
  });
});

describe('a malformed TAL is skipped and the rest of the region is still parsed', () => {
  it('rejects 0x15 with no duration digits, and parses the TALs after it', () => {
    // `+1 0x15 0x14 ...`: the separator promises a duration and no digits follow. Reading the
    // TAL anyway would mean inventing an event length.
    const broken = concat(
      ascii('+1'),
      Uint8Array.of(SEP, MARK),
      ascii('x'),
      Uint8Array.of(MARK, NUL),
    );
    const later = encodeTal({ onset: '+2', texts: ['later'] });
    const parse = parseTalRegion(padRegion(40, broken, later), 0, 40);

    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(parse.tals).toHaveLength(1);
    const kept = at(parse.tals, 0);
    expect(kept.onsetTicks).toBe(20000000n);
    expect(textsOf(kept)).toEqual(['later']);
    // Slot 1: the skipped TAL still occupied slot 0, so nothing is promoted into it.
    expect(kept.ordinal).toBe(1);
  });

  it('rejects a signed duration, which means the field after 0x15 is not the one we are reading', () => {
    const broken = concat(
      ascii('+1'),
      Uint8Array.of(SEP),
      ascii('+2'),
      Uint8Array.of(MARK),
      ascii('x'),
      Uint8Array.of(MARK, NUL),
    );
    const later = encodeTal({ onset: '+2', texts: ['later'] });
    const parse = parseTalRegion(padRegion(40, broken, later), 0, 40);

    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(parse.tals).toHaveLength(1);
    expect(textsOf(at(parse.tals, 0))).toEqual(['later']);
  });

  it('rejects a timestamp that is not terminated by 0x14', () => {
    const broken = concat(ascii('+1'), Uint8Array.of(NUL));
    const later = encodeTal({ onset: '+2', texts: ['later'] });
    const parse = parseTalRegion(padRegion(32, broken, later), 0, 32);

    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(textsOf(at(parse.tals, 0))).toEqual(['later']);
  });

  it('keeps a TAL whose onset lost its mandatory sign, because the value is unambiguous', () => {
    // parseSignedTicks reports ok:false with the magnitude intact for exactly this case: the
    // grammar is violated and the number is not in doubt, so the annotation survives with a
    // TAL_MALFORMED note rather than being deleted.
    const unsigned = concat(
      ascii('1.5'),
      Uint8Array.of(MARK),
      ascii('x'),
      Uint8Array.of(MARK, NUL),
    );
    const parse = parseTalRegion(padRegion(24, unsigned), 0, 24);

    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    const tal = at(parse.tals, 0);
    expect(tal.onsetRaw).toBe('1.5');
    expect(tal.onsetTicks).toBe(15000000n);
    expect(textsOf(tal)).toEqual(['x']);
  });

  it('keeps an unterminated last text verbatim, because those bytes are unambiguous', () => {
    const tal = concat(ascii('+1'), Uint8Array.of(MARK), ascii('x'), Uint8Array.of(NUL));
    const parse = parseTalRegion(padRegion(16, tal), 0, 16);

    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(textsOf(at(parse.tals, 0))).toEqual(['x']);
  });

  it('flags 0x15 inside a text run and still keeps the text verbatim', () => {
    const tal = concat(
      ascii('+1'),
      Uint8Array.of(MARK),
      ascii('a'),
      Uint8Array.of(SEP),
      ascii('b'),
      Uint8Array.of(MARK, NUL),
    );
    const parse = parseTalRegion(padRegion(16, tal), 0, 16);

    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(textsOf(at(parse.tals, 0))).toEqual([`a${String.fromCharCode(SEP)}b`]);
  });

  it('reports each defect once per region, with an occurrence count', () => {
    // A corrupt region can hold thousands of malformed TALs; one diagnostic each would be an
    // unbounded allocation dressed up as diligence. Nothing is hidden: `occurrences` says how
    // many there were, and the first one's offset locates them.
    const first = concat(ascii('1'), Uint8Array.of(MARK), ascii('a'), Uint8Array.of(MARK, NUL));
    const second = concat(ascii('2'), Uint8Array.of(MARK), ascii('b'), Uint8Array.of(MARK, NUL));
    const parse = parseTalRegion(padRegion(32, first, second), 0, 32);

    expect(parse.issues).toHaveLength(1);
    const issue = at(parse.issues, 0);
    expect(issue.code).toBe('TAL_MALFORMED');
    expect(issue.occurrences).toBe(2);
    expect(issue.byteOffsetInRegion).toBe(0);
    expect(parse.tals).toHaveLength(2);
  });

  it('does not let one defect describe another with the opposite disposition', () => {
    /*
     * `TAL_MALFORMED` covers nine structurally different defects, and their dispositions are
     * opposites: a 0x15 inside a text run KEEPS the TAL, a bad onset DISCARDS it. Collapsing on
     * the code alone let whichever came first own the `detail`, the offset and the `raw`, so this
     * region — one of each — reported "the text was kept verbatim" with occurrences 2 while the
     * "Seizure" annotation had in fact been thrown away. `TalIssue.detail` promises to state
     * "what was wrong AND what was done about it" (fixed in 0.3.19).
     */
    const kept = concat(
      ascii('+1'),
      Uint8Array.of(MARK),
      ascii('a'),
      Uint8Array.of(SEP),
      ascii('b'),
      Uint8Array.of(MARK, NUL),
    );
    const discarded = concat(
      ascii('??'),
      Uint8Array.of(MARK),
      ascii('Seizure'),
      Uint8Array.of(MARK, NUL),
    );
    const parse = parseTalRegion(padRegion(48, kept, discarded), 0, 48);

    // One TAL survived, so exactly one of the two dispositions applied to each.
    expect(parse.tals).toHaveLength(1);
    expect(parse.issues).toHaveLength(2);
    expect(codes(parse)).toEqual(['TAL_MALFORMED', 'TAL_MALFORMED']);
    expect(at(parse.issues, 0).detail).toContain('the text was kept verbatim');
    expect(at(parse.issues, 1).detail).toContain('so the TAL was skipped');
    for (const issue of parse.issues) expect(issue.occurrences).toBe(1);
  });

  it('reports the same two whichever order they appear in', () => {
    // Reversed, the old behaviour told the mirror-image lie: "so the TAL was skipped" with
    // occurrences 2, about a region whose second TAL was kept.
    const kept = concat(
      ascii('+1'),
      Uint8Array.of(MARK),
      ascii('a'),
      Uint8Array.of(SEP),
      ascii('b'),
      Uint8Array.of(MARK, NUL),
    );
    const discarded = concat(
      ascii('??'),
      Uint8Array.of(MARK),
      ascii('Seizure'),
      Uint8Array.of(MARK, NUL),
    );
    const parse = parseTalRegion(padRegion(48, discarded, kept), 0, 48);

    expect(parse.tals).toHaveLength(1);
    expect(parse.issues).toHaveLength(2);
    expect(at(parse.issues, 0).detail).toContain('so the TAL was skipped');
    expect(at(parse.issues, 1).detail).toContain('the text was kept verbatim');
  });

  it('still collapses many occurrences of the SAME defect', () => {
    // The property the collapsing exists for. Three TALs whose onsets are all differently
    // malformed are one issue with occurrences 3 — the key is the defect kind, not the detail
    // string, and several details interpolate the bytes they found.
    const bad = (raw: string) =>
      concat(ascii(raw), Uint8Array.of(MARK), ascii('x'), Uint8Array.of(MARK, NUL));
    const parse = parseTalRegion(padRegion(48, bad('??'), bad('!!'), bad('##')), 0, 48);

    expect(parse.issues).toHaveLength(1);
    expect(at(parse.issues, 0).occurrences).toBe(3);
    expect(parse.tals).toHaveLength(0);
  });
});

describe('a TAL with no terminating 0x00', () => {
  const unterminated = encodeTal({ onset: '+1', texts: ['x'], omitTerminator: true });

  it('is discarded when it runs to the region end, rather than into the next signal', () => {
    const parse = parseTalRegion(unterminated, 0, unterminated.length);
    expect(parse.tals).toEqual([]);
    expect(codes(parse)).toEqual(['TAL_TRUNCATED_AT_REGION_END']);
  });

  it('is indistinguishable from a terminated one when NUL padding follows, so it simply parses', () => {
    // `region = *TAL *%x00`: a TAL missing its 0x00 followed by n pad bytes is byte-for-byte a
    // TAL with its 0x00 followed by n-1 pad bytes. There is no defect to report here, and a
    // reader that invented one would fire on conforming files.
    const parse = parseTalRegion(padRegion(16, unterminated), 0, 16);
    expect(parse.issues).toEqual([]);
    const tal = at(parse.tals, 0);
    expect(textsOf(tal)).toEqual(['x']);
    expect(tal.byteLength).toBe(unterminated.length + 1);
  });

  it('swallows the following TAL, and the swallowed 0x15 is what makes it visible', () => {
    // The realistic damage: the next TAL's onset and duration become text runs of this one. It is
    // detectable only because a text run may not contain 0x15.
    const next = encodeTal({ onset: '+2', duration: 3, texts: ['y'] });
    const parse = parseTalRegion(padRegion(32, unterminated, next), 0, 32);

    expect(parse.tals).toHaveLength(1);
    const tal = at(parse.tals, 0);
    expect(tal.onsetTicks).toBe(10000000n);
    expect(textsOf(tal)).toEqual(['x', `+2${String.fromCharCode(SEP)}3`, 'y']);
    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
  });
});

describe('region padding', () => {
  it('accepts a region whose tail after the last TAL is all 0x00', () => {
    const parse = parseTalRegion(padRegion(32, encodeTal({ onset: '+0' })), 0, 32);
    expect(parse.issues).toEqual([]);
    expect(parse.tals).toHaveLength(1);
  });

  it('accepts a region that is entirely padding', () => {
    const parse = parseTalRegion(new Uint8Array(32), 0, 32);
    expect(parse.issues).toEqual([]);
    expect(parse.tals).toEqual([]);
  });

  it('reports non-NUL bytes after the padding and resumes parsing at them', () => {
    // Stopping at the pad would lose every annotation after it, which a writer that pads between
    // TALs produces routinely. Recovery is bounded: each attempt consumes at least one byte.
    const parse = parseTalRegion(
      padRegion(
        40,
        encodeTal({ onset: '+0' }),
        Uint8Array.of(NUL, NUL),
        encodeTal({ onset: '+5', texts: ['late'] }),
      ),
      0,
      40,
    );

    expect(codes(parse)).toEqual(['TAL_REGION_NOT_NUL_TERMINATED']);
    expect(at(parse.issues, 0).byteOffsetInRegion).toBe(7);
    expect(parse.tals).toHaveLength(2);
    expect(parse.tals.map((tal) => tal.ordinal)).toEqual([0, 1]);
    const recovered = at(parse.tals, 1);
    expect(recovered.onsetTicks).toBe(50000000n);
    expect(textsOf(recovered)).toEqual(['late']);
  });

  it('never gives slot 0 to a TAL found after padding', () => {
    // Slot 0 is a POSITION, not "the first TAL we managed to parse". annotations.ts reads slot 0
    // of the first annotation signal as the record's timekeeping TAL, so promoting a recovered
    // TAL into it would silently rewrite the record's start time from an ordinary event.
    const parse = parseTalRegion(
      padRegion(32, Uint8Array.of(NUL, NUL), encodeTal({ onset: '+5', texts: ['x'] })),
      0,
      32,
    );

    expect(codes(parse)).toEqual(['TAL_REGION_NOT_NUL_TERMINATED']);
    const tal = at(parse.tals, 0);
    expect(tal.ordinal).toBe(1);
    expect(tal.byteOffsetInRegion).toBe(2);
  });
});

describe('texts, onsets and durations', () => {
  it('turns several 0x14-separated runs under one onset into several texts', () => {
    // EDF+ 2.2.3: one timestamp may carry several descriptions, and each is its own annotation.
    const parse = parseTalRegion(
      padRegion(40, encodeTal({ onset: '+3', texts: ['one', 'two', 'three'] })),
      0,
      40,
    );

    expect(parse.issues).toEqual([]);
    const tal = at(parse.tals, 0);
    expect(textsOf(tal)).toEqual(['one', 'two', 'three']);
    expect(tal.onsetTicks).toBe(30000000n);
    for (const run of tal.texts) {
      expect(run.byteLength).toBe(run.text.length);
    }
  });

  it('locates every text run at the bytes it came from', () => {
    const region = padRegion(40, encodeTal({ onset: '+3', texts: ['one', 'two'] }));
    const parse = parseTalRegion(region, 0, 40);

    for (const run of at(parse.tals, 0).texts) {
      const bytes = region.subarray(
        run.byteOffsetInRegion,
        run.byteOffsetInRegion + run.byteLength,
      );
      expect(String.fromCharCode(...bytes)).toBe(run.text);
    }
  });

  it('reads a duration and keeps its digits', () => {
    const parse = parseTalRegion(
      padRegion(32, encodeTal({ onset: '+1', duration: '2.5', texts: ['apnea'] })),
      0,
      32,
    );

    const tal = at(parse.tals, 0);
    expect(tal.durationRaw).toBe('2.5');
    expect(tal.durationTicks).toBe(25000000n);
  });

  it('leaves the duration undefined when there is no 0x15, rather than defaulting it to zero', () => {
    // A zero-length event and an event of unstated length are different claims about the file.
    const parse = parseTalRegion(padRegion(32, encodeTal({ onset: '+1', texts: ['x'] })), 0, 32);
    const tal = at(parse.tals, 0);
    expect(tal.durationRaw).toBeUndefined();
    expect(tal.durationTicks).toBeUndefined();
  });

  it('reads a negative onset without complaint: that is the grammar, not a defect', () => {
    const parse = parseTalRegion(
      padRegion(32, encodeTal({ onset: '-0.5', texts: ['pre-stimulus'] })),
      0,
      32,
    );
    expect(parse.issues).toEqual([]);
    expect(at(parse.tals, 0).onsetTicks).toBe(-5000000n);
  });

  it('accepts the extreme onsets that still round-trip through int64 ticks', () => {
    // recordOnsetTicks is a BigInt64Array, and assigning an out-of-range bigint to one WRAPS
    // silently. The bound is checked here so a value that cannot round-trip is never stored.
    for (const [onset, ticks] of [
      ['+922337203685.4775807', 9223372036854775807n],
      ['-922337203685.4775808', -9223372036854775808n],
    ] as ReadonlyArray<readonly [string, bigint]>) {
      const parse = parseTalRegion(padRegion(48, encodeTal({ onset, texts: ['x'] })), 0, 48);
      expect(parse.issues).toEqual([]);
      expect(at(parse.tals, 0).onsetTicks).toBe(ticks);
    }
  });

  it('skips an onset outside the int64 tick range instead of wrapping it', () => {
    const parse = parseTalRegion(
      padRegion(48, encodeTal({ onset: '+922337203686', texts: ['x'] })),
      0,
      48,
    );
    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(parse.tals).toEqual([]);
  });

  it('skips an absurdly long timestamp field before building a bigint from it', () => {
    // Bounded work on hostile input: the digits are counted before any bigint is accumulated, so
    // a region of digits cannot drive quadratic bigint arithmetic.
    const onset = `+${'1'.repeat(64)}`;
    const parse = parseTalRegion(padRegion(96, encodeTal({ onset, texts: ['x'] })), 0, 96);
    expect(codes(parse)).toEqual(['TAL_MALFORMED']);
    expect(parse.tals).toEqual([]);
  });

  it('lays consecutive TALs out end to end, counting the terminating 0x00 in each', () => {
    const first = encodeTal({ onset: '+0', texts: ['a'] });
    const second = encodeTal({ onset: '+1', texts: ['b'] });
    const parse = parseTalRegion(padRegion(32, first, second), 0, 32);

    expect(at(parse.tals, 0).byteOffsetInRegion).toBe(0);
    expect(at(parse.tals, 0).byteLength).toBe(first.length);
    expect(at(parse.tals, 1).byteOffsetInRegion).toBe(first.length);
    expect(at(parse.tals, 1).byteLength).toBe(second.length);
  });
});

describe('text is decoded as UTF-8, and the split happens first', () => {
  it('decodes a multi-byte Latin text', () => {
    const parse = parseTalRegion(
      padRegion(40, encodeTal({ onset: '+1', texts: ['Schläfrig'] })),
      0,
      40,
    );
    expect(parse.issues).toEqual([]);
    const run = at(at(parse.tals, 0).texts, 0);
    expect(run.text).toBe('Schläfrig');
    expect(run.encoding).toBe('utf-8');
    // The byte length is the UTF-8 length, not the code-unit length: 'ä' is two bytes.
    expect(run.byteLength).toBe(10);
    expect(run.text.length).toBe(9);
  });

  it('decodes a CJK text', () => {
    const parse = parseTalRegion(
      padRegion(48, encodeTal({ onset: '+1', texts: ['睡眠紡錘波'] })),
      0,
      48,
    );
    expect(parse.issues).toEqual([]);
    expect(textsOf(at(parse.tals, 0))).toEqual(['睡眠紡錘波']);
  });

  it('is safe to split on structure first: no UTF-8 byte can collide with 0x00, 0x14 or 0x15', () => {
    // The order is safe in exactly one direction. Every byte of a multi-byte UTF-8 sequence is
    // >= 0x80, so it can never be mistaken for a structural byte; whereas a string that has
    // already been decoded can no longer be split on bytes at all.
    for (const text of ['Schläfrig', '睡眠紡錘波', 'µV', '🧠', 'Ω-λ']) {
      const encoded = utf8(text);
      const multiByte = Array.from(encoded).filter((byte) => byte >= 0x80);
      // The case is only interesting if the text really is multi-byte.
      expect(multiByte.length).toBeGreaterThan(0);
      for (const byte of encoded) {
        expect([NUL, MARK, SEP]).not.toContain(byte);
      }
      // Every byte that is part of a multi-byte sequence is above the whole structural alphabet.
      expect(Math.min(...multiByte)).toBeGreaterThan(SEP);
    }
  });

  it('keeps a BOM as a character instead of silently changing the string', () => {
    const bom = Uint8Array.of(0xef, 0xbb, 0xbf);
    const region = padRegion(
      24,
      ascii('+1'),
      Uint8Array.of(MARK),
      bom,
      ascii('x'),
      Uint8Array.of(MARK, NUL),
    );
    const parse = parseTalRegion(region, 0, 24);
    expect(textsOf(at(parse.tals, 0))).toEqual([`${String.fromCharCode(0xfeff)}x`]);
  });

  const invalid: ReadonlyArray<readonly [string, Uint8Array, string]> = [
    ['a lone Latin-1 byte', concat(ascii('caf'), Uint8Array.of(0xe9)), `caf${latin1(0xe9)}`],
    ['a lone continuation byte', Uint8Array.of(0x80), latin1(0x80)],
    ['a truncated three-byte sequence', Uint8Array.of(0xe2, 0x82), latin1(0xe2, 0x82)],
    ['an overlong encoding', Uint8Array.of(0xc0, 0xaf), latin1(0xc0, 0xaf)],
  ];

  for (const [why, bytes, expected] of invalid) {
    it(`falls back to Latin-1 for ${why}, and says so`, () => {
      const region = padRegion(
        24,
        ascii('+1'),
        Uint8Array.of(MARK),
        bytes,
        Uint8Array.of(MARK, NUL),
      );
      const parse = parseTalRegion(region, 0, 24);

      expect(codes(parse)).toEqual(['ANNOTATION_TEXT_NOT_UTF8']);
      const run = at(at(parse.tals, 0).texts, 0);
      expect(run.text).toBe(expected);
      expect(run.encoding).toBe('latin-1-fallback');
      // Latin-1 is the identity map, so no byte is lost and the caller can re-decode.
      expect(run.byteLength).toBe(bytes.length);
      expect(run.text.length).toBe(bytes.length);
    });
  }

  it('marks valid runs as utf-8 even when another run in the same region is not', () => {
    const region = padRegion(
      40,
      ascii('+1'),
      Uint8Array.of(MARK),
      ascii('good'),
      Uint8Array.of(MARK),
      Uint8Array.of(0xe9),
      Uint8Array.of(MARK, NUL),
    );
    const parse = parseTalRegion(region, 0, 40);

    expect(codes(parse)).toEqual(['ANNOTATION_TEXT_NOT_UTF8']);
    const texts = at(parse.tals, 0).texts;
    expect(at(texts, 0).encoding).toBe('utf-8');
    expect(at(texts, 1).encoding).toBe('latin-1-fallback');
  });
});

describe('text is exposed verbatim', () => {
  const verbatim = [
    '  leading and trailing spaces  ',
    'REM Sleep',
    'rem sleep',
    'Sleep stage W',
    'a\tb',
    'x'.repeat(64),
  ];

  for (const text of verbatim) {
    it(`preserves ${JSON.stringify(text)} exactly`, () => {
      const parse = parseTalRegion(
        padRegion(128, encodeTal({ onset: '+1', texts: [text] })),
        0,
        128,
      );
      expect(textsOf(at(parse.tals, 0))).toEqual([text]);
    });
  }

  it('neither trims nor case-folds, so two differently written descriptions stay different', () => {
    // Annotation text is the join key against a scoring file or a stimulus log. Normalising it
    // would merge labels the file kept apart, and no option can undo that later.
    const parse = parseTalRegion(
      padRegion(64, encodeTal({ onset: '+1', texts: ['  Spindle  ', 'spindle', 'Spindle'] })),
      0,
      64,
    );
    expect(textsOf(at(parse.tals, 0))).toEqual(['  Spindle  ', 'spindle', 'Spindle']);
  });

  it('keeps an empty run as an empty text rather than dropping it', () => {
    // Dropping it here would make `+t 0x14 0x14 0x00` and `+t 0x14 0x00` indistinguishable at the
    // byte layer, and annotations.ts needs to tell them apart to describe the shorthand.
    const parse = parseTalRegion(
      padRegion(32, encodeTal({ onset: '+1', texts: ['', 'real'] })),
      0,
      32,
    );
    expect(textsOf(at(parse.tals, 0))).toEqual(['', 'real']);
  });
});

describe('splitChannelLabel implements description@@channel', () => {
  const cases: ReadonlyArray<readonly [string, string, string | undefined]> = [
    ['Spindle@@Fp1', 'Spindle', 'Fp1'],
    ['@@Fp1', '', 'Fp1'],
    ['plain description', 'plain description', undefined],
    ['trailing@@', 'trailing@@', undefined],
    ['single@at', 'single@at', undefined],
    ['a@@b@@c', 'a@@b', 'c'],
    ['  spaced  @@Fp1', '  spaced  ', 'Fp1'],
    ['REM@@EOG-L', 'REM', 'EOG-L'],
    ['@@', '@@', undefined],
  ];

  for (const [run, text, channelLabel] of cases) {
    it(`splits ${JSON.stringify(run)} into ${JSON.stringify(text)} and ${JSON.stringify(channelLabel)}`, () => {
      expect(splitChannelLabel(run)).toEqual({ text, channelLabel });
    });
  }

  it('splits at the LAST @@, because the channel is a suffix and a description may contain anything', () => {
    expect(splitChannelLabel('K@@complex@@Cz').channelLabel).toBe('Cz');
    expect(splitChannelLabel('K@@complex@@Cz').text).toBe('K@@complex');
  });

  it('does not trim the description it hands back', () => {
    expect(splitChannelLabel('  Spindle  @@Fp1').text).toBe('  Spindle  ');
  });
});

describe('previewBytes turns evidence into a readable, bounded string', () => {
  it('escapes control bytes so structural bytes are visible in a message', () => {
    expect(previewBytes(Uint8Array.of(MARK, 0x41, NUL), 0, 3)).toBe('\\x14A\\x00');
    expect(previewBytes(Uint8Array.of(SEP), 0, 1)).toBe('\\x15');
  });

  it('decodes as Latin-1, so every byte maps to exactly one visible character', () => {
    // Deliberately not UTF-8: this is evidence ABOUT bytes, including the invalid UTF-8 that is
    // being complained about, so a replacement character would destroy the evidence.
    expect(previewBytes(Uint8Array.of(0xb5, 0x56), 0, 2)).toBe('µV');
    expect(previewBytes(Uint8Array.of(0xe9), 0, 1)).toBe('é');
  });

  it('caps the copy and says it was truncated', () => {
    const bytes = new Uint8Array(120).fill(0x41);
    const preview = previewBytes(bytes, 0, bytes.length);
    expect(preview).toBe(`${'A'.repeat(TAL_PREVIEW_MAX_BYTES)}...`);
  });

  it('reads from the offset it was given', () => {
    expect(previewBytes(ascii('abcdef'), 2, 3)).toBe('cde');
  });
});
