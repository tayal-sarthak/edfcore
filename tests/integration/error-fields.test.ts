/**
 * Every field the error tables document is on the error you actually catch.
 *
 * `api-errors.md` gives each of the seven classes a table of its fields, and those tables are the
 * whole point of the classes. A caller does not branch on an error to read its message — it reads
 * `matchingIndices` to offer a choice of channel, `budgetBytes` to decide how much to ask for next
 * time, `available` to clamp a range, `receivedLength` to tell a short read from a truncated file.
 *
 * `error-classes.test.ts` checks the class-to-`edfErrorKind` table above them, because that is
 * what a cross-realm `catch` switches on. The field tables underneath were never executed. A
 * renamed field passes every check in this repository: TypeScript is happy — the rename is
 * consistent inside the package — the docs still describe the old name, and the consumer reading
 * it gets `undefined`, which in a handler looks like "this error did not carry that detail"
 * rather than like a breaking change.
 *
 * So one error of each class is provoked by the condition its row in the class table describes,
 * and every documented field is looked for on the instance: present as an own or inherited
 * property, and of the documented type where the type is one this can check.
 *
 * A field documented as `X | undefined` is allowed to be absent from the value — that is what the
 * union says — but the NAME still has to be one the class defines, so the check is that reading it
 * yields `undefined` rather than that reading it is meaningless. Anything else would make a
 * misspelt row unfalsifiable.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-errors.md') ?? '';

interface Field {
  readonly owner: string;
  readonly name: string;
  readonly type: string;
}

/**
 * The `| field | type | meaning |` tables under each `### ClassName` heading. Two of them are
 * headed by the class name instead of the word "field", because that section documents two
 * classes at once.
 */
const FIELDS: readonly Field[] = (() => {
  const rows: Field[] = [];
  let heading = '';
  let owner = '';
  let inTable = false;
  for (const line of PAGE.split('\n')) {
    const section = /^### (.+)$/.exec(line);
    if (section !== null) {
      heading = (section[1] as string).trim();
      inTable = false;
      continue;
    }
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    // `\\|` is how a union inside a table cell is written, so the escape goes before the split
    // and the pipe comes back after it. Without this every `X | undefined` row reads as `X \\`.
    const cells = line
      .slice(1, -1)
      .replaceAll('\\|', '\u0000')
      .split('|')
      .map((cell) => cell.replaceAll('\u0000', '|').trim());
    const first = (cells[0] ?? '').replaceAll('`', '');
    if (!inTable) {
      // A header row: either `| field | type | meaning |` or `| EdfSomethingError | type | ... |`.
      if (cells[1] !== 'type') continue;
      inTable = true;
      owner = first === 'field' ? heading : first;
      continue;
    }
    if (first.startsWith('---')) continue;
    rows.push({ owner, name: first, type: (cells[1] ?? '').replaceAll('`', '').trim() });
  }
  return rows;
})();

const rejects = async (call: () => Promise<unknown>): Promise<Record<string, unknown>> => {
  const error = await call().then(
    () => undefined,
    (thrown: unknown) => thrown as Record<string, unknown>,
  );
  if (error === undefined) throw new Error('the call resolved and was supposed to throw');
  return error;
};

/** A signal whose declared digital range is a single point, so no gain can be derived. */
const NO_SCALE = buildEdf({
  recordCount: 1,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4, digitalMinimum: 100, digitalMaximum: 100 }],
});

/** The same label twice, which real recordings ship: CHB-MIT carries `T8-P8` twice. */
const DUPLICATE_LABELS = buildEdf({
  recordCount: 1,
  recordDurationSeconds: 1,
  signals: [
    { label: 'T8-P8', samplesPerRecord: 4 },
    { label: 'T8-P8', samplesPerRecord: 4 },
  ],
});

/** One instance of each class, from the condition the page says produces it. */
const INSTANCES: ReadonlyMap<string, () => Promise<Record<string, unknown>>> = new Map([
  [
    'EdfFormatError',
    () =>
      rejects(async () => {
        await openEdf(byteSource(NO_SCALE), { strict: true });
      }),
  ],
  [
    'EdfScalingError',
    () =>
      rejects(async () => {
        const recording = await openEdf(byteSource(NO_SCALE));
        const signal = recording.header.signals[0];
        if (signal === undefined) throw new Error('no signal');
        toPhysical(signal, Int32Array.from([1, 2, 3]));
      }),
  ],
  [
    'EdfRangeError',
    () =>
      rejects(async () => {
        const recording = await openEdf(byteSource(minimalEdf({ recordCount: 2 })));
        await readRecords(recording, { records: { start: 0, count: 99 }, signalIndices: [0] });
      }),
  ],
  [
    'EdfSourceError',
    () =>
      rejects(async () => {
        const bytes = minimalEdf({ recordCount: 2 });
        // One byte short on every read: the contract violation the class exists for.
        await openEdf({
          byteLength: bytes.byteLength,
          read: (offset: number, length: number) =>
            Promise.resolve(bytes.subarray(offset, offset + length - 1)),
        });
      }),
  ],
  [
    'EdfBudgetError',
    () =>
      rejects(async () => {
        const header = buildEdf({
          recordCount: 0,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 60_000 }],
          raw: { recordCount: '4000'.padEnd(8, ' ') },
        });
        const recording = await openEdf({
          byteLength: header.byteLength + 4000 * 120_000,
          read: (offset: number, length: number) => {
            const out = new Uint8Array(length);
            if (offset < header.byteLength) {
              out.set(header.subarray(offset, Math.min(header.byteLength, offset + length)));
            }
            return Promise.resolve(out);
          },
        });
        await readRecords(recording, { records: { start: 0, count: 4000 }, signalIndices: [0] });
      }),
  ],
  [
    'EdfAmbiguousChannelError',
    () =>
      rejects(async () => {
        const recording = await openEdf(byteSource(DUPLICATE_LABELS));
        getSignal(recording.header, 'T8-P8');
      }),
  ],
  [
    'EdfChannelNotFoundError',
    () =>
      rejects(async () => {
        const recording = await openEdf(byteSource(DUPLICATE_LABELS));
        getSignal(recording.header, 'Fpz');
      }),
  ],
]);

/** What the documented type means for a value, where that is decidable here. */
const CHECKS: ReadonlyMap<string, (value: unknown) => boolean> = new Map([
  ['number', (value) => typeof value === 'number'],
  ['string', (value) => typeof value === 'string'],
  ['EdfDiagnosticCode', (value) => typeof value === 'string' && value.toUpperCase() === value],
  ['string | number', (value) => typeof value === 'string' || typeof value === 'number'],
  ['readonly number[]', (value) => Array.isArray(value) && value.every(Number.isInteger)],
  [
    'readonly string[]',
    (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
  ],
  [
    'EdfDiagnostic',
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { code?: unknown }).code === 'string' &&
      typeof (value as { severity?: unknown }).severity === 'string',
  ],
  [
    'readonly EdfDiagnostic[]',
    (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'object'),
  ],
  [
    'RecordRange',
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { start?: unknown }).start === 'number' &&
      typeof (value as { count?: unknown }).count === 'number',
  ],
  ["'maxMaterializeBytes'", (value) => value === 'maxMaterializeBytes'],
]);

describe('the field tables were read', () => {
  it('found one for every class the page documents', () => {
    const owners = [...new Set(FIELDS.map((field) => field.owner))].sort();
    expect(owners).toEqual([...INSTANCES.keys()].sort());
    expect(FIELDS.length).toBeGreaterThan(20);
  });

  it('recognises the types they are written in', () => {
    // A row whose type this cannot decide is still checked for existence, but if that became the
    // usual case the file would be checking spelling rather than shape.
    const undecidable = FIELDS.filter(
      (field) => !CHECKS.has(field.type.replace(/ \| undefined$/, '')),
    );
    expect(undecidable.map((field) => `${field.owner}.${field.name}: ${field.type}`)).toEqual([]);
  });
});

describe.each([...INSTANCES.keys()])('%s', (owner) => {
  it('carries every field the page gives it, with the documented type', async () => {
    const error = await (INSTANCES.get(owner) as () => Promise<Record<string, unknown>>)();
    expect(error.constructor.name).toBe(owner);

    for (const field of FIELDS.filter((entry) => entry.owner === owner)) {
      const optional = field.type.endsWith(' | undefined');
      const type = field.type.replace(/ \| undefined$/, '');
      const value = error[field.name];
      if (value === undefined) {
        // Allowed only where the union says so — and then the name still has to be one the class
        // knows, which is what stops a misspelt row from passing.
        expect(
          optional,
          `${owner}.${field.name} is documented as ${field.type} and is missing`,
        ).toBe(true);
        continue;
      }
      const check = CHECKS.get(type);
      expect(check?.(value), `${owner}.${field.name} is ${String(value)}, not ${type}`).toBe(true);
    }
  });
});
