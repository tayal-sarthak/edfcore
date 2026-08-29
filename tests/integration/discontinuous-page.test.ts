/**
 * The file `discontinuous.md` draws, built and read.
 *
 * The page opens with a diagram — six one-second records, a ten-second gap between record 2 and
 * record 3 — and everything after it is arithmetic on that picture: which chunk starts where,
 * which one carries the gap, what a two-record read either side of it spans, and what `locate`
 * answers at 13.5 s. Then it says why the numbers matter: "reading such a file as if it were
 * contiguous puts record 3 at t = 3 s when it truly starts at t = 13 s. Nothing throws, the
 * waveform looks fine, and every event you align against it is ten seconds out."
 *
 * `discontinuous.test.ts` covers EDF+D thoroughly against a different fixture — a multiple sleep
 * latency test with hour-long intervals. This builds the page's own file, so the figures a reader
 * copies are the ones a run produces.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

/** "record 0 1 2 │← 10 s gap →│ 3 4 5" starting at 0,1,2 then 13,14,15. */
const BYTES = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG C3-A2', samplesPerRecord: 256 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (recordIndex) => (recordIndex < 3 ? recordIndex : recordIndex + 10),
});

const open = async () => {
  const recording = await openEdf(byteSource(BYTES));
  return { ...recording, index: await buildRecordIndex(recording) };
};

describe('the timeline the diagram draws', () => {
  it('puts record 3 at 13 s, not at 3', async () => {
    const located = await open();
    // The whole reason the page exists: read contiguously and every event here is 10 s out.
    const { segments, gaps } = located.index;
    // `gaps` is undefined on a probed index and defined after a scan — the distinction the page
    // spends a section on, so narrowing it here rather than asserting past it is the point.
    expect(segments).toHaveLength(2);
    expect(gaps, 'a scanned index reports its gaps').toBeDefined();
    expect(gaps).toHaveLength(1);
    expect(gaps?.[0]?.durationSeconds).toBe(10);
    expect(gaps?.[0]?.startSeconds).toBe(3);
    expect(gaps?.[0]?.endSeconds).toBe(13);
  });

  it('answers locate(13.5) with the record and offset the page prints', async () => {
    // "{ recordIndex: 3, recordStartSeconds: 13, offsetInRecordSeconds: 0.5 }"
    const located = await open();
    const at = await located.index.locate(13.5);
    expect(at?.recordIndex).toBe(3);
    expect(at?.recordStartSeconds).toBe(13);
    expect(at?.offsetInRecordSeconds).toBeCloseTo(0.5, 9);
  });
});

describe('reading across the gap', () => {
  it('returns one chunk per contiguous run, with the figures the page lists', async () => {
    const located = await open();
    const signal = getSignal(located.header, 'EEG C3-A2');
    const chunks = await readWindow(located, {
      startSeconds: 2,
      durationSeconds: 12,
      signalIndices: [signal.index],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.startSeconds).toBe(2);
    expect(chunks[0]?.precededByGap).toBeUndefined();
    expect(chunks[1]?.startSeconds).toBe(13);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(10);
  });

  it('spans twelve seconds for two seconds of data when records are read by index', async () => {
    // "chunk.durationSeconds; // 12 — the SPAN, not the time covered" over records 2 and 3.
    const located = await open();
    const signal = getSignal(located.header, 'EEG C3-A2');
    const chunk = await readRecords(located, {
      records: { start: 2, count: 2 },
      signalIndices: [signal.index],
    });

    expect(chunk.startSeconds).toBe(2);
    expect(chunk.durationSeconds).toBe(12);
    // Two records' worth of samples, whatever the span: 2 x 256.
    expect(chunk.signals[0]?.sampleCount).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// The block the page prints for `index.segments` and `index.gaps`
// ---------------------------------------------------------------------------

/**
 * Every field of the two segments and the one gap, read out of the page rather than written here.
 *
 * The page prints those three objects in full — nine fields between them — and the tests above
 * and in `concepts-discontinuity.test.ts` check four: the two record ranges and the two
 * `startSeconds`. `startTicks`, `endSeconds`, each segment's own `index`, and the gap's
 * `beforeSegmentIndex`/`afterSegmentIndex` were printed and never run.
 *
 * They are the fields most worth running. `startTicks` is the exact value the whole time model
 * rests on and the only one a reader cannot verify by eye against the diagram; `endSeconds` is
 * derived from two other printed numbers, so a page that prints all three can contradict itself;
 * and the gap's two segment indices are what make it a gap between a specific pair rather than a
 * free-floating interval.
 *
 * The fields are ENUMERATED from the page, not listed, so a field added to the block is checked
 * by having been printed.
 */
const PAGE = DOCS_PAGES.get('discontinuous.md') ?? '';

/** The commented block under `index.segments;` / `index.gaps;`, as one line with no `//`. */
function printedAfter(expression: string): string {
  // Every occurrence, not the first: the page names `index.gaps` in prose before it prints one,
  // and `indexOf` alone found the mention and reported nothing printed under it.
  let from = 0;
  for (;;) {
    const at = PAGE.indexOf(`${expression};`, from);
    if (at === -1) break;
    from = at + 1;
    const lines: string[] = [];
    for (const line of PAGE.slice(at).split('\n').slice(1)) {
      if (!line.trimStart().startsWith('//')) break;
      lines.push(line.trim().replace(/^\/\/\s?/, ''));
    }
    if (lines.length > 0) return lines.join(' ').replace(/\s+/g, ' ');
  }
  throw new Error(`discontinuous.md no longer prints a block under ${expression}`);
}

/** `{ a: 1, b: { c: 2 } }, { a: 3 }` -> one entry per top-level object. */
function objectsIn(printed: string): readonly string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  for (let at = 0; at < printed.length; at += 1) {
    const character = printed[at];
    if (character === '{') {
      if (depth === 0) start = at;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) found.push(printed.slice(start + 1, at).trim());
    }
  }
  return found;
}

/** The top-level `name: value` pairs of one printed object, values kept as written. */
function fieldsOf(body: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  let depth = 0;
  let current = '';
  for (const character of `${body},`) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (character === ',' && depth === 0) {
      const [name, ...rest] = current.split(':');
      if (name !== undefined && rest.length > 0) fields.set(name.trim(), rest.join(':').trim());
      current = '';
      continue;
    }
    current += character;
  }
  return fields;
}

/** What the library holds for that field, rendered the way the page writes it. */
function rendered(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (value !== null && typeof value === 'object') {
    return `{ ${Object.entries(value)
      .map(([name, entry]) => `${name}: ${String(entry)}`)
      .join(', ')} }`;
  }
  return String(value);
}

describe('the segments and gaps the page prints in full', () => {
  it('reads three objects out of the page, so a passing run is not a vacuous one', () => {
    expect(objectsIn(printedAfter('index.segments'))).toHaveLength(2);
    expect(objectsIn(printedAfter('index.gaps'))).toHaveLength(1);
    // Nine fields between them. Stated so that a field silently dropped from the page stops
    // being checked loudly rather than quietly.
    const counted = [
      ...objectsIn(printedAfter('index.segments')),
      ...objectsIn(printedAfter('index.gaps')),
    ].reduce((total, body) => total + fieldsOf(body).size, 0);
    expect(counted).toBeGreaterThanOrEqual(15);
  });

  it('prints, for each segment, the values the scan produces', async () => {
    const { index } = await open();
    const printed = objectsIn(printedAfter('index.segments'));
    expect(index.segments).toHaveLength(printed.length);

    for (const [position, body] of printed.entries()) {
      const segment = index.segments?.[position] as unknown as Record<string, unknown>;
      expect(segment, `no segment ${position}`).toBeDefined();
      for (const [name, value] of fieldsOf(body)) {
        expect(rendered(segment[name]), `segment ${position} ${name}`).toBe(value);
      }
    }
  });

  it('prints, for the gap, the values the scan produces', async () => {
    const { index } = await open();
    const printed = objectsIn(printedAfter('index.gaps'));
    expect(index.gaps).toHaveLength(printed.length);

    const gap = index.gaps?.[0] as unknown as Record<string, unknown>;
    for (const [name, value] of fieldsOf(printed[0] as string)) {
      expect(rendered(gap[name]), `gap ${name}`).toBe(value);
    }
  });

  it('keeps the derived fields consistent with the ones beside them', async () => {
    // `endSeconds` is `startSeconds + durationSeconds`, and the page prints all three, so it can
    // contradict itself while every individual number matches something.
    const { index } = await open();
    for (const segment of index.segments ?? []) {
      expect(segment.endSeconds).toBe(segment.startSeconds + segment.durationSeconds);
      expect(segment.endTicks).toBe(segment.startTicks + segment.durationTicks);
    }
    for (const gap of index.gaps ?? []) {
      expect(gap.endSeconds).toBe(gap.startSeconds + gap.durationSeconds);
      // The gap runs from where the earlier segment ends to where the later one starts.
      expect(gap.startTicks).toBe(index.segments?.[gap.beforeSegmentIndex]?.endTicks);
      expect(gap.endTicks).toBe(index.segments?.[gap.afterSegmentIndex]?.startTicks);
    }
  });
});
