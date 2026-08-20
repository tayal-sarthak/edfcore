/**
 * No byte offset in `src/` is ever computed with a bitwise operator.
 *
 * `edf-format.md` states the hazard and then states the exemption, and both halves matter:
 *
 *   "keep every offset in plain floating-point numbers, which are exact to 2^53. A data offset in
 *    a multi-gigabyte BDF routinely exceeds 2^31, where JavaScript's bitwise operators (`|0`,
 *    `<<`, `>>>`) wrap it negative without warning."
 *
 *   "Bitwise operators are correct here, because a sample is 16 or 24 bits wide and the operations
 *    are exact on it. They're only dangerous on offsets."
 *
 * So this is not a ban. `decode/digital.ts` assembles every sample with `|` and `<<` and must; the
 * page prints the same two lines as the definition of the format. What the rule forbids is one of
 * them reaching an address, and that failure is silent in the worst way: a 22-hour BDF crosses
 * 2^31 bytes about nine hours in, so a wrapped offset reads plausible samples from the wrong place
 * for the whole back half of a recording and throws nothing.
 *
 * The guard is an inventory. Every bitwise operator in `src/` is located and has to sit in a
 * module allowed to have one, for a reason written down beside it. Adding one somewhere else is
 * then a deliberate act, which is the same shape as the export list in `public-api.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { codeOnly } from '../support/code-only.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * The modules entitled to a bitwise operator, and what each does with one.
 *
 * Every entry is a width-bounded integer, never an address. `>>` on an array index belongs here
 * for a reason worth stating: it is safe only while the index stays under 2^30, which it does
 * because the record count comes from an eight-character header field and so cannot exceed
 * 99,999,999 — two orders of magnitude of headroom, and not an accident to leave unrecorded.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    'decode/digital.ts',
    'assembles a 16- or 24-bit sample from its bytes, as the format defines it',
  ],
  ['biosemi.ts', 'reads flag bits out of a 24-bit BioSemi status sample'],
  [
    'record-index.ts',
    'halves a segment or gap array index, bounded far below 2^30 by the record count',
  ],
]);

/** Every `.ts` file under `src/`, keyed the way `ALLOWED` spells them. */
function modules(directory = SRC, prefix = ''): readonly (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    if (name.isDirectory())
      found.push(...modules(`${directory}${name.name}/`, `${prefix}${name.name}/`));
    else if (name.name.endsWith('.ts')) {
      found.push([`${prefix}${name.name}`, readFileSync(`${directory}${name.name}`, 'utf8')]);
    }
  }
  return found;
}

/**
 * Bitwise operators, on the code alone.
 *
 * Not a parser, and it does not pretend to be one. `|` and `&` are also union and intersection
 * types, and `>>` closes a nested generic, so a scan that tried to catch every spelling would
 * report most of `src/` — the first version of this did exactly that. What it matches instead are
 * the forms that are unambiguously arithmetic: a shift by a literal, a hex mask, and the bare
 * `| 0` truncation the page names by that spelling. Those are the shapes an address bug gets
 * written in, and each is one the language cannot also read as a type.
 *
 * The gap is a bare `a | b` between two variables, which no scan short of a parser can tell from
 * a union. Nothing in `src/` is written that way, and a truncation that meant to discard the high
 * bits would have to say `| 0` to do it.
 *
 * `codeOnly` strips comments and string literals first, so the docblocks that quote these
 * operators — including this one — cannot report themselves.
 */
const BITWISE = /<<\s*\d|>>>?\s*\d|&\s*0x|(?<![|=!<>])\|\s*0(?![.\dxX])/;

/** The lines of `source` that use one. */
function bitwiseLines(source: string): readonly string[] {
  return codeOnly(source)
    .split('\n')
    .filter((line) => BITWISE.test(line))
    .map((line) => line.trim());
}

describe('the offset rule', () => {
  it('is still stated on the page it comes from', () => {
    const page = (DOCS_PAGES.get('edf-format.md') ?? '').replace(/\s+/g, ' ');
    expect(page).toContain('exact to 2^53');
    expect(page).toContain("They're only dangerous on offsets");
  });

  it('found operators to check, so a passing run is not a vacuous one', () => {
    const users = modules().filter(([, source]) => bitwiseLines(source).length > 0);
    expect(users.length).toBeGreaterThan(0);
  });

  it('confines every bitwise operator in src to a module entitled to one', () => {
    const users = modules()
      .filter(([, source]) => bitwiseLines(source).length > 0)
      .map(([name]) => name);
    expect(new Set(users)).toEqual(new Set(ALLOWED.keys()));
  });

  it('gives each of those modules a reason that is not empty', () => {
    for (const [name, reason] of ALLOWED) {
      expect(reason.length, name).toBeGreaterThan(20);
    }
  });
});

describe('the hazard the rule exists for', () => {
  /** A BDF whose data section crosses 2^31 bytes: 256 channels at 1024 samples per record. */
  const BIG = {
    signals: 256,
    samplesPerRecord: 1024,
    bytesPerSample: 3,
  } as const;

  it('wraps a real BDF offset negative, exactly as the page warns', () => {
    const recordByteLength = BIG.bytesPerSample * BIG.signals * BIG.samplesPerRecord;
    // About nine hours in at one record per second, which a 22-hour recording passes through.
    const record = Math.ceil(2 ** 31 / recordByteLength);
    const offset = 256 * (BIG.signals + 1) + record * recordByteLength;

    expect(offset).toBeGreaterThan(2 ** 31);
    // Plain arithmetic is exact here and stays so up to 2^53.
    expect(Number.isSafeInteger(offset)).toBe(true);
    // The two signed operators the page names wrap it negative here, silently.
    expect(offset | 0).toBeLessThan(0);
    expect(offset >> 0).toBeLessThan(0);
    // `>>>` is unsigned, so it survives this offset and fails later instead — at 2^32, which the
    // same recording reaches in about eighteen hours. Worth stating rather than implying: an
    // offset that comes back positive is the one most likely to be believed.
    expect(offset >>> 0).toBe(offset);
    expect((2 ** 32 + offset) >>> 0).not.toBe(2 ** 32 + offset);
  });

  it('keeps edfcore’s own record arithmetic exact at that scale', async () => {
    // Not the file — a 2 GB fixture is not a test — but the header that describes it, which is
    // where every offset in the file is computed from.
    const bytes = (await import('../support/writer.js')).buildEdf({
      format: 'BDF',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: Array.from({ length: 8 }, (_unused, index) => ({
        label: `C${index}`,
        samplesPerRecord: BIG.samplesPerRecord,
      })),
    });
    const { header } = await openEdf(byteSource(bytes));

    expect(header.bytesPerSample).toBe(BIG.bytesPerSample);
    const last = getSignal(header, 'C7');
    const bigOffset =
      header.headerByteLength + 400_000 * header.recordByteLength + last.recordByteOffset;
    expect(bigOffset).toBeGreaterThan(2 ** 31);
    expect(Number.isSafeInteger(bigOffset)).toBe(true);
    // And every field the arithmetic is built from is itself a safe integer.
    for (const value of [
      header.headerByteLength,
      header.recordByteLength,
      header.bytesPerSample,
      last.recordByteOffset,
    ]) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
});
