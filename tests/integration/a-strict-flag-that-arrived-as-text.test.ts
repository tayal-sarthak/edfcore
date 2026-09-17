/**
 * `strict` given as text, and read as false.
 *
 * `strict` is resolved everywhere as `options?.strict === true`. That comparison never coerces,
 * which is the right way to read a boolean and also what makes the mistake silent: `'true'`, `'1'`
 * and `1` are each not-`true`, so the parse was LENIENT and said nothing.
 *
 * `assertParseOptions` exists for exactly that outcome and describes it in its own words — a file
 * with a would-be diagnostic coming back "as a header carrying a list, from a caller who asked to
 * receive no such file at all". It guarded the OPTIONS being a bare value. The field inside them,
 * which is the whole of `ParseOptions`, was never checked, so the same failure was reachable through
 * the guard rather than past it.
 *
 * Text is what arrives here. `strict` is the only boolean option in this package, and a CLI flag, a
 * query parameter and a JSON or YAML config key all hand over a string — which is the argument
 * `requireItemLimit` makes for its own coercion check, one module over.
 *
 * `strict` is read in one place, `DiagnosticSink`, and every parse in the package reaches it: one
 * check covers `parseHeader`, `readHeader`, `openEdf`, `decodeAnnotations`, `buildTimeline` and
 * `buildRecordIndex`. `inspectEdf` takes no parse options at all — it is documented as never strict,
 * because a triage call that threw on the first impolite field would be useless for the files it
 * exists to describe.
 */

import { describe, expect, it } from 'vitest';
import { EdfFormatError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { setHeaderField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

/** A file carrying a real defect, so `strict` has something to throw on. */
const DEFECTIVE = setHeaderField(
  buildEdf({
    format: 'EDF',
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  }),
  'recordCount',
  '-1      ',
);

/** Every spelling of "yes" that is not the boolean. */
const AS_TEXT: ReadonlyArray<readonly [string, unknown]> = [
  ['the string "true"', 'true'],
  ['the string "1"', '1'],
  ['the number 1', 1],
  ['the string "yes"', 'yes'],
];

describe.each(AS_TEXT)('strict given as %s', (_name, strict) => {
  it('is refused by parseHeader rather than parsing leniently', () => {
    let thrown: Error | undefined;
    try {
      parseHeader(DEFECTIVE, DEFECTIVE.byteLength, { strict } as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the parse collected its diagnostics instead').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('options.strict must be true or false');
    expect(thrown?.message).toContain('Next:');
  });

  it('is refused at every entry point that takes a parse option', async () => {
    const source = (): ReturnType<typeof byteSource> => byteSource(DEFECTIVE);
    await expect(openEdf(source(), { strict } as never)).rejects.toThrow(/options.strict/);
    await expect(readHeader(source(), { strict } as never)).rejects.toThrow(/options.strict/);
    await expect(buildRecordIndex(await openEdf(source()), { strict } as never)).rejects.toThrow(
      /options.strict/,
    );
  });

  it('says where text comes from, since that is how it arrives', () => {
    const thrown = ((): Error | undefined => {
      try {
        parseHeader(DEFECTIVE, DEFECTIVE.byteLength, { strict } as never);
        return undefined;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(thrown?.message).toContain('arrive as text');
  });
});

describe('the boolean itself', () => {
  it('still throws on the first real defect when true', () => {
    expect(() => parseHeader(DEFECTIVE, DEFECTIVE.byteLength, { strict: true })).toThrow(
      EdfFormatError,
    );
  });

  it('still collects when false, and when omitted', () => {
    const lenient = parseHeader(DEFECTIVE, DEFECTIVE.byteLength, { strict: false });
    expect(lenient.diagnostics.length).toBeGreaterThan(0);
    expect(parseHeader(DEFECTIVE, DEFECTIVE.byteLength).diagnostics.length).toBeGreaterThan(0);
  });

  it('still collects when strict is explicitly undefined', () => {
    const parsed = parseHeader(DEFECTIVE, DEFECTIVE.byteLength, { strict: undefined } as never);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it('leaves the bare-options refusal of 0.6.154 saying its own thing', async () => {
    await expect(openEdf(byteSource(DEFECTIVE), true as never)).rejects.toThrow(
      /the parse options are a boolean, not an object/,
    );
  });
});
