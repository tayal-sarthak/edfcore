/**
 * Every command, over every awkward shape, without the corpus.
 *
 * The CLI is where an unfamiliar file arrives — that is the argument the page makes for it, "so
 * you can look at a file before writing any code" — and the test that runs it over unfamiliar real
 * files, `tests/corpus/cli-corpus.test.ts`, skips without `npm run corpus:fetch`. Offline,
 * `cli.test.ts` runs the commands over `minimalEdf` and `minimalEdfPlus`: two tidy files.
 *
 * The shapes in `awkward-files.ts` are the ones a command can be surprised by. A file with no data
 * signal at all makes `signals` an empty listing and `gaps` a question about a recording that has
 * none; a zero record duration takes the time axis away from `gaps` and the rate away from
 * `signals`; a duplicate label breaks the one lookup `header` does by name. Six commands over
 * eleven shapes is sixty-six invocations, and what they must not do is throw, write to stderr on
 * success, or print a value that is the word `undefined`.
 *
 * That last one has a precise form, because the word appears legitimately in prose: the
 * `ZERO_RECORD_DURATION` diagnostic says "it makes every sample rate undefined", which is the
 * sentence a reader needs. What must never appear is a rendered VALUE that is `undefined` — a
 * field of the tab-separated listing, a leaf of the JSON, the right-hand side of a `label: value`
 * line. Those are the ones that mean `String(undefined)` reached the output, and a zero record
 * duration is exactly the file that produces one.
 *
 * The exit codes are checked against their meaning rather than against a constant: `validate`
 * returns 1 for a file carrying an error-severity diagnostic and 0 otherwise, which is the CI gate
 * the page documents. Every other command returns 0 for a file that parses.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { byteSource, openEdf } from '../../src/index.js';
import { AWKWARD } from '../support/awkward-files.js';

const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

const COMMANDS = ['header', 'validate', 'events', 'signals', 'gaps', 'json'] as const;

/**
 * C0 and DEL, by code point rather than by pattern: a control character written into a regular
 * expression is itself the thing the lint rule forbids, and `printable` is the reason none of
 * these can appear — a control byte in a header field reaches the output as a dot.
 */
function hasControlCharacter(line: string): boolean {
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    // Tab and newline are the CLI's own structure — `signals` and `gaps` are tab-separated. A tab
    // arriving from a header FIELD is the thing that must not get here, and `printable` turns
    // that one into a dot, which `cli-signals-columns.test.ts` pins.
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** `label: undefined` and friends — a value slot, not the word in a sentence. */
const RENDERED_ABSENCE = /(?::|\t|^)\s*(?:undefined|NaN|\[object Object\])\s*$/;

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function invoke(argv: readonly string[], bytes: Uint8Array): Promise<Run> {
  let out = '';
  let err = '';
  const io: CliIo = {
    readFile: async () => bytes,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const code = await runCli(parseArgs(argv), io);
  return { code, out, err };
}

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  for (const command of COMMANDS) {
    it(`${command} survives it, where ${awkward}`, async () => {
      const { code, out, err } = await invoke([command, 'a.edf'], bytes);

      // `validate` is the CI gate: 1 means the file carries an error, not that the run failed.
      const { header } = await openEdf(byteSource(bytes));
      const hasError = header.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
      expect(code, `${command} exit code`).toBe(command === 'validate' && hasError ? 1 : 0);

      // Nothing on stderr for a file that parsed, whatever the exit code says about its contents.
      expect(err, `${command} wrote to stderr`).toBe('');
      expect(out.length, `${command} printed nothing`).toBeGreaterThan(0);
      expect(out.endsWith(NEWLINE), `${command} left a partial last line`).toBe(true);

      for (const line of out.split(NEWLINE)) {
        expect(
          hasControlCharacter(line),
          `${command} printed a control byte: ${JSON.stringify(line)}`,
        ).toBe(false);
        expect(
          RENDERED_ABSENCE.test(line),
          `${command} rendered an absent value: ${JSON.stringify(line)}`,
        ).toBe(false);
      }
    });
  }

  it(`prints no absent value in a field of the listing, where ${awkward}`, async () => {
    // The tab-separated listing has known field boundaries, so "a value that is the word" can be
    // checked exactly rather than by pattern. A zero record duration puts an empty rate here.
    const { out } = await invoke(['signals', 'a.edf'], bytes);
    for (const line of out
      .trim()
      .split(NEWLINE)
      .filter((row) => row.length > 0)) {
      const fields = line.split(TAB);
      expect(fields).toHaveLength(6);
      for (const field of fields) {
        expect(['undefined', 'NaN', 'null', '[object Object]']).not.toContain(field);
      }
    }
  });

  it(`emits JSON whose every leaf is a value, where ${awkward}`, async () => {
    const { out } = await invoke(['json', 'a.edf'], bytes);
    const parsed: unknown = JSON.parse(out);
    const leaves: unknown[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry);
      } else if (value !== null && typeof value === 'object') {
        for (const entry of Object.values(value)) walk(entry);
      } else {
        leaves.push(value);
      }
    };
    walk(parsed);
    expect(leaves.length).toBeGreaterThan(5);
    for (const leaf of leaves) {
      expect(leaf, 'a JSON leaf is the WORD rather than a value').not.toBe('undefined');
      expect(leaf).not.toBe('NaN');
      if (typeof leaf === 'number') expect(Number.isFinite(leaf)).toBe(true);
    }
  });
});

describe('the run reached both exit codes', () => {
  it('has a shape that validates clean and one that does not', async () => {
    // Without both, the exit-code assertion above is a constant dressed as a rule.
    const codes = await Promise.all(
      AWKWARD.map(async (file) => (await invoke(['validate', 'a.edf'], file.bytes)).code),
    );
    expect(codes).toContain(0);
    expect(codes).toContain(1);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the seventeen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(17);
  });
});
