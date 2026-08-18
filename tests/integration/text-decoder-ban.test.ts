/**
 * `TextDecoder` is used in `src/tal/` and nowhere else, and a header byte proves why.
 *
 * `AGENTS.md` lists this under things that look like bugs and are not, and `src/bytes/latin1.ts`
 * gives the reason: verified on Node v24.4.0, `TextDecoder('latin1' | 'iso-8859-1' | 'ascii' |
 * 'windows-1252')` all report `encoding === 'windows-1252'` and decode byte `0x80` as `U+0080`,
 * while the WHATWG Encoding Standard mandates `U+20AC` for those labels. So the same header would
 * produce different strings in Node and in a spec-compliant browser — a library whose whole claim
 * is that it reads the same bytes the same way everywhere, quietly not doing that.
 *
 * `src/tal/` is the exception because EDF+ annotation text is genuinely UTF-8, which is the one
 * encoding every runtime agrees on. Header text is Latin-1 and goes through `decodeHeaderLatin1`,
 * which is `String.fromCharCode` and therefore the identity map by construction.
 *
 * Two checks, and the first has a trap in it worth naming: `header/fields.ts` contains the string
 * `TextDecoder` inside a diagnostic message that explains this very rule to a user. Stripping
 * comments is not enough — string literals have to go too, or the file that documents the ban
 * reads as the file that breaks it. It looked exactly like a violation until the line was read.
 * That stripper is `tests/support/code-only.ts`, shared with the `Date` ban, which has the same
 * shape and the same trap.
 *
 * The second check is the consequence rather than the rule. `latin1.test.ts` pins
 * `decodeHeaderLatin1` in isolation; this puts `0x80` in a real header field and reads it back
 * through `openEdf`, which is where a `TextDecoder` introduced anywhere on the header path would
 * show up as a euro sign.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { codeOnly } from '../support/code-only.js';
import { minimalEdfPlus } from '../support/writer.js';

const SRC = new URL('../../src/', import.meta.url);

const MODULES: ReadonlyArray<{ readonly name: string; readonly code: string }> = (function walk(
  dir: URL,
  prefix: string,
  into: Array<{ name: string; code: string }>,
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(child, `${prefix}${entry.name}/`, into);
    else if (entry.name.endsWith('.ts')) {
      into.push({ name: `${prefix}${entry.name}`, code: codeOnly(readFileSync(child, 'utf8')) });
    }
  }
  return into;
})(SRC, '', []);

const USERS = MODULES.filter(({ code }) => /\bTextDecoder\b/.test(code)).map(({ name }) => name);

describe('the ban, in the source', () => {
  it('read the tree and stripped it, so a passing run is not a vacuous one', () => {
    expect(MODULES.length).toBeGreaterThan(40);
    // The stripper has to remove the mention inside `header/fields.ts`'s diagnostic message and
    // keep the real call in `tal/grammar.ts` — one file proves each direction.
    const fields = MODULES.find(({ name }) => name === 'header/fields.ts');
    expect(fields?.code.includes('TextDecoder')).toBe(false);
    expect(readFileSync(new URL('header/fields.ts', SRC), 'utf8')).toContain('TextDecoder');
  });

  it('is used only under src/tal/', () => {
    expect(USERS.length).toBeGreaterThan(0);
    const outside = USERS.filter((name) => !name.startsWith('tal/'));
    expect(outside, 'modules outside src/tal/ that reference TextDecoder').toEqual([]);
  });
});

describe('the consequence, through a real file', () => {
  it('reads header byte 0x80 as U+0080 rather than the windows-1252 euro sign', async () => {
    const label = `EEG\u0080Fpz`;
    const bytes = minimalEdfPlus({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label, samplesPerRecord: 4 }],
    });

    const recording = await openEdf(byteSource(bytes));
    const [signal] = recording.header.signals;
    expect(signal?.label).toBe(label);
    expect(signal?.label.codePointAt(3)).toBe(0x80);
    // What a WHATWG-conformant decoder would have produced for that byte.
    expect(signal?.label).not.toContain(String.fromCodePoint(0x20ac));
  });
});
