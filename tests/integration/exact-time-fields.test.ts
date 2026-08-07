/**
 * Every time edfcore REPORTS is available exactly.
 *
 * Seconds in this package are float64 conversions of exact 100 ns tick counts, and the ticks are
 * what a comparison, a boundary or a sum must use. That rule was applied one type at a time —
 * `EdfTimeline` in 0.3.4, `EdfSegment` and `EdfGap` in 0.3.6, `EdfChunk` and `EdfChunkSignal` in
 * 0.3.7 — and 0.3.7's changelog claimed the set was then closed. It was not: `EdfLocation` and the
 * two envelope types still published seconds alone, and every one of those values had been
 * computed exactly and converted away at the return.
 *
 * The claim was wrong because it was made by memory instead of by a check. This is the check.
 *
 * It reads `src/types.ts` rather than inspecting values, because the point is the DECLARED shape:
 * a field that only sometimes appears would pass a runtime test on the file that happens to
 * populate it. A new `*Seconds` field on a reported type now has to arrive with its counterpart or
 * fail here.
 *
 * SELECTION types are exempt and listed as such. A caller passes a window in seconds and
 * `secondsToTicks` rounds it to the nearest tick by design — a caller's `30.0` must resolve to
 * 300000000 ticks — so there is nothing exact being discarded on the way in.
 */

import { describe, expect, it } from 'vitest';

const TYPES_SOURCE = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
).glob('../../src/types.ts', { query: '?raw', import: 'default', eager: true });

const SOURCE = Object.values(TYPES_SOURCE)[0] ?? '';

/**
 * Types a CALLER fills in, not ones edfcore returns. Nothing exact is lost on the way in.
 */
const SELECTION_TYPES = new Set([
  'EdfAnnotationWindow',
  'RecordSelection',
  'StreamSelection',
  'TriggerSelection',
  'WindowSelection',
  'EnvelopeSelection',
]);

/**
 * Fields whose seconds are not on the tick axis at all, with the reason.
 *
 * `secondsSinceMidnight` is a wall-clock field parsed from the header's `hh.mm.ss`, whole seconds
 * by construction. `secondsPerBucket` is a resolution, not an instant: a bucket boundary is a
 * rational that generally falls between ticks, so a tick counterpart would have to round and
 * would be less true than the float.
 */
const NOT_ON_THE_TICK_AXIS = new Set(['secondsSinceMidnight', 'secondsPerBucket']);

/**
 * Counterparts that exist under a name the mechanical rule does not derive.
 *
 * `EdfAnnotation.onsetTicks` predates `onsetTicksFromFirstRecord` and is documented as the
 * header's own timebase, which is exactly what `onsetSecondsFromHeaderStart` is. The value is
 * there and always has been; only the two names disagree. Renaming a shipped public field to
 * satisfy a test would be the test dictating the API, so the alias is written down instead.
 */
const ALIASES: Readonly<Record<string, string>> = {
  'EdfAnnotation.onsetSecondsFromHeaderStart': 'onsetTicks',
};

interface Declared {
  readonly name: string;
  readonly seconds: readonly string[];
  readonly ticks: readonly string[];
}

function declaredInterfaces(source: string): readonly Declared[] {
  const out: Declared[] = [];
  const pattern = /export interface (\w+)\s*(?:extends [\w, ]+\s*)?\{([\s\S]*?)\n\}/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1] ?? '';
    const body = match[2] ?? '';
    out.push({
      name,
      seconds: [...body.matchAll(/readonly (\w*[Ss]econds\w*)\??:/g)].map((m) => m[1] ?? ''),
      ticks: [...body.matchAll(/readonly (\w*[Tt]icks\w*)\??:/g)].map((m) => m[1] ?? ''),
    });
  }
  return out;
}

/** `startSeconds` -> `startTicks`, `onsetSecondsFromFirstRecord` -> `onsetTicksFromFirstRecord`. */
function counterpartOf(secondsField: string): string {
  return secondsField.replace(/Seconds/, 'Ticks').replace(/^seconds/, 'ticks');
}

describe('the exact counterpart rule', () => {
  const declared = declaredInterfaces(SOURCE);

  it('finds the interfaces it is supposed to be checking', () => {
    // A regex that silently matched nothing would make every assertion below vacuous.
    const names = declared.map((d) => d.name);
    expect(names).toContain('EdfTimeline');
    expect(names).toContain('EdfLocation');
    expect(names).toContain('EdfEnvelopeChunk');
    expect(declared.filter((d) => d.seconds.length > 0).length).toBeGreaterThan(10);
  });

  it('gives every reported seconds field a ticks field beside it', () => {
    const missing: string[] = [];
    for (const { name, seconds, ticks } of declared) {
      if (SELECTION_TYPES.has(name)) continue;
      for (const field of seconds) {
        if (NOT_ON_THE_TICK_AXIS.has(field)) continue;
        const wanted = ALIASES[`${name}.${field}`] ?? counterpartOf(field);
        if (!ticks.includes(wanted)) missing.push(`${name}.${field} has no ${wanted}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the exemption lists honest', () => {
    // An exemption for a type that no longer exists is an exemption nobody is reading.
    const names = new Set(declared.map((d) => d.name));
    for (const name of SELECTION_TYPES)
      expect(names, `${name} is listed but absent`).toContain(name);
    const everySecondsField = new Set(declared.flatMap((d) => d.seconds));
    for (const field of NOT_ON_THE_TICK_AXIS) {
      expect(everySecondsField, `${field} is listed but absent`).toContain(field);
    }
    for (const qualified of Object.keys(ALIASES)) {
      const [type, field] = qualified.split('.');
      const declaration = declared.find((d) => d.name === type);
      expect(declaration?.seconds, `${qualified} is aliased but absent`).toContain(field);
    }
  });
});
