/**
 * `Date` appears nowhere in `src/`, and nothing edfcore returns is one.
 *
 * `AGENTS.md` states it in five words — "No `Date` anywhere. EDF stores local time with no zone" —
 * and the reason is the whole of it. An EDF header gives a wall-clock date and time and says
 * nothing about a zone, because the machine that wrote it was in a sleep lab and the field is
 * whatever the clock on the wall said. A `Date` cannot hold that: constructing one applies the
 * running machine's zone, so a recording started at 23:14 in Leiden becomes a different instant
 * on a laptop in California, and every derived time moves with it. `EdfCalendarDate` is three
 * numbers precisely so there is nothing to interpret.
 *
 * `dates.test.ts` already asserts a parsed HEADER holds no `Date`. This covers the other two
 * ways it could arrive: from the source, where `Date.now()` would also make output
 * non-deterministic, and from anywhere else on a full read — the recording, the timeline, the
 * index, the annotations, a validation report.
 *
 * Comments and string literals are stripped first, the same reasoning `TextDecoder`'s ban needs:
 * this codebase discusses dates constantly and a file that explains why it avoids `Date` must not
 * read as a file that uses one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
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

describe('the ban, in the source', () => {
  it('read the tree and stripped it, so a passing run is not a vacuous one', () => {
    expect(MODULES.length).toBeGreaterThan(40);
    // `startDate`, `birthDate`, `EdfCalendarDate` are all fine — the word boundary is what makes
    // this a check on the global rather than on every identifier ending in "Date".
    expect(/\bDate\b/.test('const startDate = 1;')).toBe(false);
    expect(/\bDate\b/.test('new Date()')).toBe(true);
  });

  it('names the global in no module', () => {
    const users = MODULES.filter(({ code }) => /\bDate\b/.test(code)).map(({ name }) => name);
    expect(users, 'modules referencing the Date global').toEqual([]);
  });
});

describe('and nothing a read hands back is one', () => {
  /** Every `Date` reachable from a value, by path, following arrays and plain objects. */
  function datesIn(value: unknown, path: string, seen: Set<unknown>, found: string[]): string[] {
    if (value === null || typeof value !== 'object') return found;
    if (seen.has(value)) return found;
    seen.add(value);
    if (value instanceof Date) {
      found.push(path);
      return found;
    }
    if (ArrayBuffer.isView(value)) return found;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      datesIn(child, `${path}.${key}`, seen, found);
    }
    return found;
  }

  it('can find one when it is there', () => {
    // Without this the sweep below would pass on a walker that never recursed.
    expect(datesIn({ a: { b: [new Date()] } }, 'probe', new Set(), [])).toEqual(['probe.a.b.0']);
  });

  it('leaves no Date on a whole read of a real file', async () => {
    const bytes = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const annotations = await readAnnotations(recording, { start: 0, count: 4 });
    const report = await validateRecording(recording);

    const found = [
      ...datesIn(recording.header, 'header', new Set(), []),
      ...datesIn(recording.timeline, 'timeline', new Set(), []),
      ...datesIn(index, 'index', new Set(), []),
      ...datesIn(annotations, 'annotations', new Set(), []),
      ...datesIn(report, 'report', new Set(), []),
    ];
    expect(found, 'values edfcore returned that are Date instances').toEqual([]);
  });
});
