/**
 * Every name a `Next:` clause points at, resolved.
 *
 * `next-clause.test.ts` proves every thrown message and every diagnostic has one.
 * `the-advice-works.test.ts` follows the eight whose advice is a concrete instruction. This is the
 * mechanical half between them: of the 160-odd clauses in `src/`, most name something — a function
 * to call instead, an option to raise, a field to read — and a name that no longer exists is the
 * way this rots. Nothing renames a public export without noticing, but a message is a string, so a
 * clause mentioning it is not a reference and no compiler follows it.
 *
 * Three kinds of name are checked, each against the thing it would have to be true of:
 *
 * - `something()` must be exported from `edfcore`, `edfcore/node` or `edfcore/validate`. Advice that
 *   names an internal helper is advice a reader cannot take.
 * - `options.something` must be a declared option field, read out of `src/`. The two misdiagnoses
 *   `options.ts` records were both of this shape — a message naming a lever the caller does not
 *   hold.
 * - `header.something`, `signal.something`, `index.something` must exist on a real object, checked
 *   with `in` against a recording opened from a fixture rather than against a type. A field that is
 *   declared and never populated would satisfy a type check and still leave the reader looking for
 *   something that is not there.
 *
 * The extraction is deliberately narrow about what counts as advice. Comments are stripped first,
 * so a helper mentioned in a note beside a message is not mistaken for a name the message uses.
 * `${...}` interpolations are stripped too: `Next: ${adapterFor(source)}` names no function to the
 * reader — the function is how the sentence was built, not what it says.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as universal from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import * as nodeEntry from '../../src/node.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import * as validateEntry from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

// ---------------------------------------------------------------------------
// The clauses
// ---------------------------------------------------------------------------

function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
      continue;
    }
    if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
  }
  return into;
}

const SRC = new URL('../../src/', import.meta.url);
const FILES = sourceFiles(SRC, '', []).sort();
const SOURCE = FILES.map((name) => readFileSync(new URL(name, SRC), 'utf8')).join('\n');

/** Comments first: a helper named in a note beside a message is not advice. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '');

/** An interpolation is how the sentence was built, not what it says. */
const TEXT = CODE.replace(/\$\{[^{}]*\}/g, 'X');

/**
 * From `Next:` to the end of the message, across the `'…' + '…'` seams a long one is written in.
 * Stopping at the first seam would read half of every clause, and the half that names the field is
 * usually the second.
 */
const CLAUSES: readonly string[] = [
  ...TEXT.matchAll(/Next: ((?:[^'`]|['`]\s*\+\s*\n?\s*['`])*)/g),
].map((match) =>
  (match[1] ?? '')
    .replace(/['`]\s*\+\s*\n?\s*['`]/g, '')
    .replace(/\s+/g, ' ')
    .trim(),
);

/** `something(` not preceded by a dot: a call the reader is being told to make. */
const NAMED_FUNCTIONS = new Set(
  CLAUSES.flatMap((clause) =>
    [...clause.matchAll(/(?:^|[^.\w])([a-z][A-Za-z0-9]*)\(/g)].map((match) => match[1] ?? ''),
  ),
);

const ROOTS = ['header', 'signal', 'index', 'recording', 'timeline', 'chunk'] as const;

/** One EDF+D file with a gap, which is enough for every root a clause names. */
const LIVE_FIXTURE = buildEdf({
  plus: 'D',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 5),
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const NAMED_MEMBERS = new Set(
  CLAUSES.flatMap((clause) =>
    [...clause.matchAll(new RegExp(`\\b(${ROOTS.join('|')})\\.([A-Za-z]+)`, 'g'))].map(
      (match) => match[0],
    ),
  ),
);

const NAMED_OPTIONS = new Set(
  CLAUSES.flatMap((clause) =>
    [...clause.matchAll(/\boptions\.([A-Za-z]+)/g)].map((match) => match[1] ?? ''),
  ),
);

describe('the clauses were found', () => {
  it('are enough of them that a passing run is not a vacuous one', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(CLAUSES.length).toBeGreaterThan(100);
  });

  it('read as advice rather than as source, which is what the stripping is for', () => {
    // One clause, in the words it is written in.
    expect(CLAUSES.some((clause) => clause.includes('await buildRecordIndex(recording)'))).toBe(
      true,
    );
    // And no clause carries a brace, which is what over-capturing into code looks like. A
    // semicolon is not a tell: several clauses use one as punctuation.
    for (const clause of CLAUSES) {
      expect(clause, clause).not.toMatch(/[{}]/);
    }
  });

  it('name something in most of them', () => {
    expect(NAMED_FUNCTIONS.size).toBeGreaterThanOrEqual(10);
    expect(NAMED_MEMBERS.size).toBeGreaterThanOrEqual(12);
    expect(NAMED_OPTIONS.size).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// And every one of them resolves
// ---------------------------------------------------------------------------

describe('every function a clause tells you to call', () => {
  const EXPORTED = new Set([
    ...Object.keys(universal),
    ...Object.keys(nodeEntry),
    ...Object.keys(validateEntry),
  ]);

  it('is exported from one of the three entry points, or is a method on a value edfcore hands back', async () => {
    expect(EXPORTED.size).toBeGreaterThan(50);

    const recording = await openEdf(byteSource(LIVE_FIXTURE));
    const index = await buildRecordIndex(recording);
    // The two clauses that name a method rather than an export: `call locate(seconds)` on the
    // index, and `read(offset, length)` on a source. Both are resolved on the real object.
    const methods = new Set(
      [index, recording.source].flatMap((value) => {
        const members = value as unknown as Record<string, unknown>;
        return Object.keys(members).filter((key) => typeof members[key] === 'function');
      }),
    );

    for (const name of NAMED_FUNCTIONS) {
      expect(EXPORTED.has(name) || methods.has(name), `Next: … ${name}()`).toBe(true);
    }
    // Both kinds are represented, so neither branch is carrying the whole assertion.
    expect([...NAMED_FUNCTIONS].some((name) => EXPORTED.has(name))).toBe(true);
    expect([...NAMED_FUNCTIONS].some((name) => !EXPORTED.has(name) && methods.has(name))).toBe(
      true,
    );
  });
});

describe('every option a clause tells you to set', () => {
  /** Every optional member of every exported interface in `src/`, which is where options live. */
  const DECLARED = new Set(
    [...SOURCE.matchAll(/^\s*readonly ([A-Za-z]+)\?:/gm)].map((match) => match[1] ?? ''),
  );

  it('is a field some options type declares', () => {
    expect(DECLARED.size).toBeGreaterThan(10);
    for (const name of NAMED_OPTIONS) {
      expect(DECLARED.has(name), `Next: … options.${name}`).toBe(true);
    }
  });
});

describe('every field a clause tells you to read', () => {
  const FIXTURE = LIVE_FIXTURE;
  it('exists on the object the clause names it on', async () => {
    const recording = await openEdf(byteSource(FIXTURE));
    const index = await buildRecordIndex(recording);
    const signal = recording.header.signals[0];
    if (signal === undefined) throw new Error('fixture has no signal');

    const roots: Record<string, object> = {
      header: recording.header,
      signal,
      index,
      recording,
      timeline: recording.timeline,
    };

    for (const reference of NAMED_MEMBERS) {
      const [root = '', member = ''] = reference.split('.');
      const object = roots[root];
      // `chunk` is the one root no clause below names on a live object; if one starts to, it needs
      // a fixture here rather than a pass.
      expect(object, reference).toBeDefined();
      expect(member in (object ?? {}), reference).toBe(true);
    }
  });

  it('is populated rather than merely declared, wherever it is not optional by design', async () => {
    const recording = await openEdf(byteSource(FIXTURE));
    // A spot check that the `in` above is doing real work: these are the fields the clauses lean
    // on most, and all of them carry a value on this file.
    expect(recording.header.dataSignalIndices.length).toBeGreaterThan(0);
    expect(recording.header.annotationSignalIndices.length).toBeGreaterThan(0);
    expect(recording.header.recordCount).toBe(4);
    expect(recording.header.diagnostics.length).toBeGreaterThanOrEqual(0);
  });
});
