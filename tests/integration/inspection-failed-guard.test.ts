/**
 * `INSPECTION_FAILED` is a guard, not a code anyone receives today.
 *
 * `diagnosticOf` in `inspect.ts` has two arms. The first turns an `EdfFormatError` into the
 * diagnostic it already carries; the second names the other case — "the header did not fail its
 * grammar, some other rule refused it" — and emits `INSPECTION_FAILED`, one of the six codes
 * `open-union-codes.test.ts` lists as deliberately outside the registry.
 *
 * Nothing can reach that second arm. `inspectEdf` wraps exactly one call, `parseHeader`, and every
 * `EdfError` `parseHeader` can throw comes from a `DiagnosticSink` — whose `fatal` and `report`
 * both construct an `EdfFormatError` and nothing else. Its only other throw is a plain
 * `RangeError` for a bad `sourceByteLength`, which is not an `EdfError` at all and is rethrown
 * one line earlier (0.4.456).
 *
 * That is worth pinning rather than deleting, for the reason `validate.ts` gives about its own
 * idle date check: the day the parse path throws an `EdfRangeError` or an `EdfSourceError` — a
 * budget refusal moved earlier, a scaling rule that refuses at parse time — this is the arm that
 * has to be there, and a missing one is harder to notice than an idle one. What this file adds is
 * the tripwire: the premise is checked, so the comment cannot quietly stop being true.
 *
 * The check is structural, because that is where the premise lives. Every module `parseHeader`
 * reaches is scanned for a directly constructed-and-thrown `EdfError`; the sink is the one channel
 * a fatal may take, and its class is asserted at runtime.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DiagnosticSink } from '../../src/diagnostics/collector.js';
import { EdfFormatError, isEdfError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { setHeaderField, setSignalField, truncateBy } from '../support/corrupt.js';
import { buildEdf, minimalEdf, minimalEdfPlus } from '../support/writer.js';

const SRC = new URL('../../src/', import.meta.url);

/** `from './x.js'` with the `type` keyword or without it, as `module-layers.test.ts` reads them. */
const IMPORTS = /^import\s+(type\s+)?[^;]*?from '(\.[^']+)'/gm;

/** Runtime imports only: a type-only import emits nothing, so it cannot carry a throw. */
function reachableFrom(entry: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (found.has(name)) continue;
    const text = readFileSync(new URL(name, SRC), 'utf8');
    found.set(name, text);
    for (const match of text.matchAll(IMPORTS)) {
      if (match[1] !== undefined) continue;
      const dir = name.includes('/') ? `${name.slice(0, name.lastIndexOf('/'))}/` : '';
      queue.push(
        new URL(`${dir}${match[2] as string}`, 'file:///').pathname
          .slice(1)
          .replace(/\.js$/, '.ts'),
      );
    }
  }
  return found;
}

const PARSE_PATH = reachableFrom('header/parse.ts');

/** Malformed in a different way each time, and fatal every time. */
const REFUSED: ReadonlyArray<readonly [string, Uint8Array]> = [
  ['no fixed header at all', truncateBy(minimalEdf(), minimalEdf().byteLength - 100)],
  ['a comma decimal in the record duration', setHeaderField(minimalEdf(), 'recordDuration', '0,5')],
  ['a signal count that is not a number', setHeaderField(minimalEdf(), 'signalCount', 'many')],
  ['a negative sample count', setSignalField(minimalEdf(), 1, 0, 'samplesPerRecord', '-4')],
  [
    'EDF+ with no annotations signal',
    buildEdf({
      plus: 'C',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    }),
  ],
];

describe('the parse path was read', () => {
  it('resolved a graph large enough that a passing run is not a vacuous one', () => {
    expect(PARSE_PATH.size).toBeGreaterThan(10);
    // The modules the argument actually depends on, named so a resolver that silently walked
    // nothing fails here rather than passing the scan below by reaching no files.
    for (const name of ['diagnostics/collector.ts', 'header/fields.ts', 'header/signals.ts']) {
      expect([...PARSE_PATH.keys()]).toContain(name);
    }
  });
});

/**
 * `header/lookup.ts` is on the graph and holds three `throw new EdfChannelNotFoundError` /
 * `EdfAmbiguousChannelError` sites, none of which a parse can reach: `signals.ts` imports the one
 * pure predicate in the file, `isAnnotationLabel`, and the throws live in `getSignal` and
 * `findSignals`, which a caller reaches only afterwards with a header in hand.
 *
 * Exempting a module by name would make the scan below unfalsifiable, so the exemption is a check
 * of its own — the binding list is what keeps it true. An import of `getSignal` added to the parse
 * path fails here, and `INSPECTION_FAILED` becomes reachable in the same commit.
 */
const LOOKUP = 'header/lookup.ts';

describe('every EdfError the parse can throw is a format error', () => {
  it('reaches the one function in header/lookup.ts that cannot throw, and no other', () => {
    const bindings = new Set<string>();
    for (const [name, text] of PARSE_PATH) {
      if (name === LOOKUP) continue;
      for (const match of text.matchAll(/^import \{([^}]*)\} from '([^']+)'/gm)) {
        const dir = name.includes('/') ? `${name.slice(0, name.lastIndexOf('/'))}/` : '';
        const target = new URL(`${dir}${match[2] as string}`, 'file:///').pathname
          .slice(1)
          .replace(/\.js$/, '.ts');
        if (target !== LOOKUP) continue;
        for (const part of (match[1] as string).split(',')) {
          const binding = part.trim().replace(/^type\s+/, '');
          if (binding.length > 0) bindings.add(binding);
        }
      }
    }
    expect([...bindings].sort()).toEqual(['isAnnotationLabel']);
  });

  it('constructs none of the other six classes directly', () => {
    // `EdfFormatError` included: the sink is the only thing that may build one, because the
    // diagnostics collected before a fatal travel with it and a direct construction loses them.
    const direct = [...PARSE_PATH]
      .filter(([name]) => name !== LOOKUP)
      .flatMap(([name, text]) =>
        [...text.matchAll(/throw new (Edf[A-Za-z]*Error)/g)].map(
          (m) => `${name}: ${m[1] as string}`,
        ),
      )
      .sort();
    expect(direct).toEqual([]);
  });

  it('and the sink builds an EdfFormatError, which is what makes the scan above conclusive', () => {
    const sink = new DiagnosticSink();
    const fatal = sink.fatal({ code: 'TRUNCATED_FILE', message: 'synthesised by a test' });
    expect(fatal).toBeInstanceOf(EdfFormatError);
    expect(fatal.edfErrorKind).toBe('format');
  });

  it.each(REFUSED)('refuses %s as a format error', (_name, bytes) => {
    let thrown: unknown;
    try {
      parseHeader(bytes, bytes.byteLength);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(true);
    expect((thrown as { edfErrorKind: string }).edfErrorKind).toBe('format');
  });
});

describe('so inspectEdf never reports it', () => {
  it.each(REFUSED)('diagnoses %s without INSPECTION_FAILED', async (_name, bytes) => {
    const inspection = await inspectEdf(byteSource(bytes));
    expect(inspection.ok).toBe(false);
    // Non-vacuous: something was reported, and it was the file's own defect rather than the
    // placeholder for a refusal triage could not name.
    expect(inspection.diagnostics.length).toBeGreaterThan(0);
    expect(inspection.diagnostics.map((d) => d.code)).not.toContain('INSPECTION_FAILED');
  });

  it('reports the file’s own codes on a header that parses but is impolite', async () => {
    const inspection = await inspectEdf(byteSource(minimalEdfPlus()));
    expect(inspection.ok).toBe(true);
    expect(inspection.diagnostics.map((d) => d.code)).not.toContain('INSPECTION_FAILED');
  });
});
