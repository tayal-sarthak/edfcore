/**
 * Every thrown message says what to do next.
 *
 * `AGENTS.md` states it as an absolute: "Every thrown message ends with a `Next:` clause naming
 * what the caller should do. If the cause is an edfcore bug rather than a caller mistake, say
 * that: `Next: report this`." Ninety throws in `src/` keep it and nothing checked that they did,
 * which makes it a convention rather than a contract — the ninety-first would have been the
 * first message that left a reader with a description of a problem and no move.
 *
 * The clause is the part that survives contact with a real user. "byte range [0, 512) is outside
 * the 256-byte buffer" tells someone what happened; "Next: check that the header and these bytes
 * came from the same file" tells them what it means. Two of these messages say `Next: report
 * this`, because the condition they describe is unreachable without an edfcore bug, and that is
 * the honest answer rather than advice a caller cannot act on.
 *
 * Finding the end of a `throw` without parsing TypeScript is the awkward part. Parenthesis
 * balancing does not work: `[${offset}, ${offset + length})` closes one, and the first version of
 * this check reported the two messages containing that exact interval notation as violations. So
 * the window runs to the first `);` that ends a line, and stops early at the next `throw` so a
 * neighbour's clause can never vouch for a message that has none.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Thrown {
  readonly file: string;
  readonly className: string;
  readonly text: string;
}

const SOURCES: ReadonlyArray<{ name: string; text: string }> = (function walk(
  dir: URL,
  prefix: string,
  into: Array<{ name: string; text: string }>,
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(child, `${prefix}${entry.name}/`, into);
    else if (entry.name.endsWith('.ts')) {
      into.push({ name: `${prefix}${entry.name}`, text: readFileSync(child, 'utf8') });
    }
  }
  return into;
})(new URL('../../src/', import.meta.url), '', []);

/** Every `throw new X(...)` in a file, with the argument text as written. */
function thrownIn(name: string, source: string): Thrown[] {
  const found: Thrown[] = [];
  for (const match of source.matchAll(/throw new (\w+)\(/g)) {
    const start = (match.index ?? 0) + match[0].length;

    const lineEnd = /\);\s*\n/g;
    lineEnd.lastIndex = start;
    const closed = lineEnd.exec(source);

    const neighbour = source.indexOf('throw new', start);
    const stop = Math.min(
      closed === null ? source.length : closed.index,
      neighbour === -1 ? source.length : neighbour,
    );
    found.push({ file: name, className: match[1] as string, text: source.slice(start, stop) });
  }
  return found;
}

const THROWS: readonly Thrown[] = SOURCES.flatMap(({ name, text }) => thrownIn(name, text));

describe('the throws were found', () => {
  it('found enough of them that a passing run is not a vacuous one', () => {
    expect(THROWS.length).toBeGreaterThan(80);
    // Both halves of the convention are represented: the package's own error types and the plain
    // `RangeError`s reserved for conditions only an edfcore bug can reach.
    const classes = new Set(THROWS.map((thrown) => thrown.className));
    expect(classes).toContain('EdfRangeError');
    expect(classes).toContain('RangeError');
  });

  it('reads a message whole, including one with a close paren inside it', () => {
    // `[${offset}, ${offset + length})` — the notation that defeats parenthesis balancing.
    const interval = THROWS.find((thrown) => thrown.text.includes('is outside the'));
    expect(interval, 'the byte-range message').toBeDefined();
    expect(interval?.text).toContain('Next:');
  });

  it('stops at the next throw, so one clause cannot vouch for two messages', () => {
    const source = [
      '  throw new RangeError(`no advice here`',
      '  );',
      '  throw new RangeError(`and this one has it. Next: do the thing`);',
    ].join('\n');
    const parsed = thrownIn('probe.ts', source);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.text).not.toContain('Next:');
  });
});

describe('every thrown message names a next step', () => {
  it('leaves none without one', () => {
    const silent = THROWS.filter((thrown) => !thrown.text.includes('Next:')).map(
      (thrown) => `${thrown.file}: ${thrown.text.replace(/\s+/g, ' ').trim().slice(0, 80)}`,
    );
    expect(silent, 'thrown messages with no "Next:" clause').toEqual([]);
  });
});

/**
 * The other half: the diagnostics.
 *
 * `EdfFormatError` is never thrown with `new` — it is built from a diagnostic by `fatalError`,
 * `sink.fatal`, `scalingError` and `toFormatError`, so a check that reads only `throw new` sees
 * none of the sixty-one messages those carry. They are the same contract and the larger share of
 * it: a diagnostic names the field, the bytes as written, the rule it violates, and what to do,
 * and the last of those is the `Next:` clause.
 *
 * Together the two halves are 151 messages, which is the "over 150" `AGENTS.md` claims.
 *
 * A `message:` whose value is `string` is a type declaration rather than a message, so the value
 * has to open with a quote or a backtick to count.
 */
const DIAGNOSTIC_MESSAGES: readonly Thrown[] = SOURCES.flatMap(({ name, text }) =>
  [...text.matchAll(/^\s*message:\s*(?=['`])/gm)].map((match) => {
    const start = (match.index ?? 0) + match[0].length;
    const rest = text.slice(start);
    // Ends at the next property of the same object literal, or at the literal's close.
    const end = rest.search(/\n\s*(?:[a-zA-Z#]+:|\}\)|\},)/);
    return {
      file: name,
      className: 'diagnostic',
      text: rest.slice(0, end === -1 ? rest.length : end),
    };
  }),
);

describe('every diagnostic message names a next step too', () => {
  it('found them, so a passing run is not a vacuous one', () => {
    expect(DIAGNOSTIC_MESSAGES.length).toBeGreaterThan(50);
    // The declarations, excluded: `readonly message: string;` is not a message.
    expect(DIAGNOSTIC_MESSAGES.every((one) => !/^string[;,]/.test(one.text.trim()))).toBe(true);
  });

  it('leaves none without one', () => {
    const silent = DIAGNOSTIC_MESSAGES.filter((one) => !one.text.includes('Next:')).map(
      (one) => `${one.file}: ${one.text.replace(/\s+/g, ' ').trim().slice(0, 80)}`,
    );
    expect(silent, 'diagnostic messages with no "Next:" clause').toEqual([]);
  });

  it('adds up to the number AGENTS.md states', () => {
    const claimed = /over (\d+)\s+do\b/.exec(
      readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8'),
    );
    expect(claimed, 'no "over N do" in AGENTS.md').not.toBeNull();
    expect(THROWS.length + DIAGNOSTIC_MESSAGES.length).toBeGreaterThan(Number(claimed?.[1]));
  });
});
