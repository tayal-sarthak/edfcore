/**
 * The published `EdfAnnotation` table lists every field the type has.
 *
 * `api-types.md` listed thirteen of the fourteen. The missing one was
 * `onsetTicksFromFirstRecord` — and its absence was not a gap but a swap: the table described
 * `onsetTicks` as being "on the same axis as the rebased value", and the prose said "compare event
 * times with `onsetTicks` and nothing else".
 *
 * `onsetTicks` is on the HEADER's timebase. `src/types.ts` says so in the docblock that generates
 * the published `.d.ts`, and calls it "the wrong one for comparing an annotation against a window".
 * A reader following the page compared it against `chunk.startTicks` and `readWindow` bounds, which
 * the same page puts on the `t = 0 = start of record 0` axis, and every event landed up to a second
 * late with nothing to indicate it (fixed in 0.3.58).
 *
 * The field list is read off a decoded annotation rather than written down here, so a field added
 * to the interface fails this test until the table lists it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const API_TYPES = readFileSync(
  new URL('../../website/src/content/docs/api-types.md', import.meta.url),
  'utf8',
);

/** A file whose record 0 starts a quarter-second in, so the two onset axes differ. */
const OFFSET_FILE = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  startOffsetSeconds: 0.25,
  signals: [{ label: 'A', samplesPerRecord: 2 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (recordIndex: number) =>
        recordIndex === 1 ? [{ onset: '+1.25', texts: ['marker'] }] : [],
    },
  ],
});

async function annotation(): Promise<EdfAnnotation> {
  const recording = await openEdf(byteSource(OFFSET_FILE));
  const [event] = (await readAnnotations(recording, { start: 0, count: 4 })).annotations;
  if (event === undefined) throw new Error('expected one annotation');
  return event;
}

/**
 * The `| `EdfAnnotation` | type | meaning |` table, on its own.
 *
 * Scoped rather than searched page-wide: `EdfRecordIndex` has an `onsetTicks` row too, and a
 * page-wide search for that row finds the method rather than the field.
 */
function annotationTable(): string {
  const start = API_TYPES.indexOf('| `EdfAnnotation` | type | meaning |');
  if (start === -1) throw new Error('api-types.md has no EdfAnnotation table');
  const rest = API_TYPES.slice(start);
  const end = rest.indexOf('\n\n');
  return end === -1 ? rest : rest.slice(0, end);
}

function documentedFields(): readonly string[] {
  return [...annotationTable().matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1] as string);
}

describe('the EdfAnnotation table in api-types.md', () => {
  it('reads a non-empty table', () => {
    // Without this, a table that stopped matching would make the assertion below vacuous.
    expect(documentedFields().length).toBeGreaterThan(10);
  });

  it('lists every field a decoded annotation carries', async () => {
    const documented = new Set(documentedFields());
    const missing = Object.keys(await annotation()).filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });

  it('does not describe onsetTicks as the rebased field', async () => {
    // The two axes really do differ on this file, which is what makes the wording load-bearing.
    const event = await annotation();
    expect(event.onsetTicks).toBe(12_500_000n);
    expect(event.onsetTicksFromFirstRecord).toBe(10_000_000n);

    const row =
      annotationTable()
        .split('\n')
        .find((line) => line.startsWith('| `onsetTicks` |')) ?? '';
    expect(row).toContain('header');
    expect(row).not.toContain('same axis as the rebased value');
  });
});
