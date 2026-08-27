/**
 * "A field that may be absent is `T | undefined`, and the key is always there."
 *
 * That is the first convention `api-types.md` states, in bold, above every table on the page, and
 * the sentence after it says what it is for: "Reading a result never requires knowing whether a
 * key exists." A caller writes `header.startTime.resolvedDate === undefined`, not
 * `'resolvedDate' in header.startTime`, and destructures a result without guarding each name.
 *
 * Two halves, and they fail differently.
 *
 * The TYPE half — optional (`?`) is reserved for options you pass in — is checked by reading
 * `src/types.ts`: every optional member must live in an interface the CALLER constructs. An
 * optional member on a result type is not a compile error anywhere; it just quietly makes
 * `result.field` a name TypeScript will not let you read without a guard, one field at a time.
 *
 * The RUNTIME half is the one a type cannot catch at all. A result assembled with a conditional
 * spread — `...(date === undefined ? {} : { resolvedDate: date })` — satisfies `T | undefined`
 * and omits the key, so `Object.keys` is short, `in` is false, and a structured clone or a JSON
 * round-trip loses a field that the table says is always there. Nothing in the type system
 * notices; `hasOwn` does.
 *
 * The fixture is chosen so the interesting fields are ABSENT-valued rather than present: an
 * unreadable start date, a signal with no usable scale, an annotation with no duration, a
 * discontinuous file so a segment has a gap before it and the last has none. A result whose every
 * field happens to be defined proves nothing about the claim.
 *
 * What this does NOT check: that the field lists are the page's. That is
 * `type-tables.test.ts`, which compares each table against its interface. This reads the
 * interfaces, so the two together mean the page's tables are what is asserted here.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const TYPES = new URL('../../src/types.ts', import.meta.url);

/** The members of `export interface Name`, with whether each is optional. */
function membersOf(
  source: string,
  name: string,
): ReadonlyArray<{ name: string; optional: boolean }> {
  const start = source.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`no interface ${name} in types.ts`);
  const body = source.slice(start + `export interface ${name} {`.length);
  const members: Array<{ name: string; optional: boolean }> = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const member = /^ {2}(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*[:(]/.exec(line);
      if (member?.[1] !== undefined) {
        members.push({ name: member[1], optional: member[2] === '?' });
      }
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth < 0) break;
  }
  return members;
}

/** A file that leaves as many documented fields undefined as one file can. */
const BYTES = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 5,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (recordIndex) => (recordIndex < 3 ? recordIndex : recordIndex + 7),
  // Not a date: `startTime.resolvedDate` is the page's own example of an absent field.
  raw: { startDate: 'xx.xx.xx' },
  signals: [
    // A degenerate digital range, so `signal.scale` is undefined.
    { label: 'Fp1', samplesPerRecord: 8, digitalMinimum: 0, digitalMaximum: 0 },
    { label: 'Resp', samplesPerRecord: 3 },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      // No duration on either, so `annotation.durationTicks` and `durationSeconds` are undefined.
      tals: (recordIndex) => [{ onset: recordIndex + 0.5, texts: [`event ${recordIndex}`] }],
    },
  ],
});

describe('optional is reserved for what a caller passes in', () => {
  it('leaves no result type with an optional member', async () => {
    const source = await readFile(TYPES, 'utf8');
    const optionalOwners = new Set<string>();
    let current: string | undefined;
    let depth = 0;
    for (const line of source.split('\n')) {
      const declaration = /^export (?:interface|type) ([A-Za-z_$][\w$]*)/.exec(line);
      if (declaration !== null && depth === 0) current = declaration[1];
      if (/^\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\?\s*:/.test(line) && current !== undefined) {
        optionalOwners.add(current);
      }
      depth = Math.max(
        0,
        depth + (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length,
      );
    }

    expect(
      optionalOwners.size,
      'no optional members found at all — the reader is broken',
    ).toBeGreaterThan(5);
    // The names a caller writes: options they hand in, and the selection a stream is given.
    for (const owner of optionalOwners) {
      expect(
        owner,
        `${owner} has an optional member and is not something a caller constructs`,
      ).toMatch(/(?:Options|Selection)$/);
    }
  });
});

describe('every declared field of a result is an own property of it', () => {
  it('holds across the model, on a file that leaves many of them undefined', async () => {
    const source = await readFile(TYPES, 'utf8');

    const recording = await openEdf(byteSource(BYTES));
    const index = await buildRecordIndex(recording);
    const located = await index.locate(1);
    // By record, not by window: this file is genuinely discontinuous, and a time window over one
    // needs the scanned index rather than the probed one `openEdf` returns. The chunk is the same
    // shape either way, and the shape is what this is about.
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 3 },
      signalIndices: recording.header.dataSignalIndices,
    });
    const annotations = await readAnnotations(recording, { start: 0, count: 5 });
    const inspection = await inspectEdf(byteSource(BYTES));
    const signal = recording.header.signals[0];
    const withScale = recording.header.signals[1];

    const cases: ReadonlyArray<[string, unknown]> = [
      ['EdfRecording', recording],
      ['EdfHeader', recording.header],
      ['EdfSignal', signal],
      ['EdfScale', withScale?.scale],
      ['EdfRawSignalFields', signal?.raw],
      ['EdfRawHeaderFields', recording.header.raw],
      ['EdfStartTime', recording.header.startTime],
      ['EdfPatientId', recording.header.patient],
      ['EdfRecordingId', recording.header.recording],
      ['EdfTimeline', recording.timeline],
      ['EdfRecordIndex', index],
      // `segments`/`gaps` are `| undefined` until the index is scanned, and this one is —
      // `buildRecordIndex` returns `coverage: 'complete'`, which is what puts them there.
      ['EdfSegment', index.segments?.[0]],
      ['EdfGap', index.gaps?.[0]],
      ['EdfLocation', located],
      ['EdfChunk', chunk],
      ['EdfChunkSignal', chunk.signals[0]],
      ['EdfAnnotationsResult', annotations],
      ['EdfAnnotation', annotations.annotations[0]],
      ['EdfDiagnostic', recording.header.diagnostics[0]],
      ['EdfInspection', inspection],
    ];

    // The claim is about absent VALUES, so the fixture has to produce some. Without this the run
    // would pass on a file where every field happens to be defined, which proves nothing.
    let undefinedFields = 0;

    for (const [name, instance] of cases) {
      expect(instance, `no ${name} instance to check`).toBeDefined();
      if (instance === undefined) continue;
      const record = instance as Record<string, unknown>;
      for (const member of membersOf(source, name)) {
        expect(member.optional, `${name}.${member.name} is optional on a result type`).toBe(false);
        expect(
          Object.hasOwn(record, member.name),
          `${name}.${member.name} is declared but not an own property`,
        ).toBe(true);
        if (record[member.name] === undefined) undefinedFields += 1;
      }
    }

    expect(
      undefinedFields,
      'no field came back undefined, so the claim was never tested',
    ).toBeGreaterThanOrEqual(5);
  });
});
