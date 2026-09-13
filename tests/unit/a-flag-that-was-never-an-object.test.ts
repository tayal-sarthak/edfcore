/**
 * `strict`, passed as itself rather than as a field on an options object.
 *
 * 0.6.130 and 0.6.140 refused a bare value where an options object belongs — in the three
 * formatters and in `cachedSource` — and made the argument for it: every option in this package is
 * a field on an object, so the value a caller means IS the option, and `formatAnnotations(list, 20)`
 * is what gets written when the intent is twenty rows.
 *
 * `strict` is the sharpest case of that argument and was not covered. It is the only boolean
 * option in the package, so `openEdf(source, true)` is the shortest thing a caller can write for
 * "refuse a file that departs from the spec" — and `types.ts` calls it "the one option that
 * changes what a parse does rather than what it costs".
 *
 * It read as `undefined`. The parse ran lenient, and a file with a would-be diagnostic came back
 * as a header carrying a list — to a caller who, in the words of the option's own docblock, "would
 * rather not receive a file at all than inspect it". Nothing said the flag had been dropped, and
 * the result is a well-formed `EdfHeader` either way, so there was nothing downstream to notice.
 *
 * The guard sits in the `DiagnosticSink` constructor, which that module calls "the one place
 * `strict` is turned into a decision", so `parseHeader`, `readHeader`, `openEdf`,
 * `decodeAnnotations` and `buildTimeline` are all covered by it. `buildRecordIndex` needs its own,
 * because it SPREADS its options into the decode options and spreading a bare value yields `{}` —
 * a perfectly good object by the time a sink sees it.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

/** A degenerate physical range: one error-severity diagnostic, which `strict` exists to throw on. */
const FILE = buildEdf({
  format: 'EDF',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8, physicalMinimum: 5, physicalMaximum: 5 }],
});

const CALLS: ReadonlyArray<readonly [string, (options: unknown) => Promise<unknown>]> = [
  ['openEdf', (options) => openEdf(byteSource(FILE), options as never)],
  ['readHeader', (options) => readHeader(byteSource(FILE), options as never)],
  ['parseHeader', async (options) => parseHeader(FILE, FILE.byteLength, options as never)],
  [
    'buildRecordIndex',
    async (options) => buildRecordIndex(await openEdf(byteSource(FILE)), options as never),
  ],
];

describe.each(CALLS)('%s, given a bare value where the options belong', (_name, call) => {
  it.each([
    ['true, the flag itself', true],
    ['false', false],
    ['a string', 'strict'],
  ])('refuses %s rather than parsing leniently', async (_shape, options) => {
    const thrown = await call(options).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the call resolved with the flag dropped').toBeDefined();
    expect(thrown?.message).toContain('strict is a field on one');
    expect(thrown?.message).toContain('Next:');
  });

  it('still takes no options at all', async () => {
    await expect(call(undefined)).resolves.toBeDefined();
  });

  it('still takes null as "no options", which is what it already meant', async () => {
    await expect(call(null)).resolves.toBeDefined();
  });
});

describe('the options object itself', () => {
  it('still throws on the first diagnostic when strict is set', async () => {
    await expect(openEdf(byteSource(FILE), { strict: true })).rejects.toThrow(
      /DEGENERATE_PHYSICAL_RANGE/,
    );
  });

  it('still collects rather than throws when it is not', async () => {
    const recording = await openEdf(byteSource(FILE), { strict: false });
    expect(recording.header.diagnostics.length).toBeGreaterThan(0);
  });
});
