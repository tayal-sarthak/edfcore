/**
 * The barrel is the product surface.
 *
 * DESIGN section 3 is titled "Public API — every exported symbol", so a symbol listed there and
 * missing from `src/index.ts` is a shipping bug, not a stylistic one. The tables below enumerate
 * that section by hand and assert each symbol exists AND is the right kind of thing: a free
 * function, a class, or a constant with a pinned value.
 *
 * Three further claims are pinned here because nothing else in the suite can see them:
 *
 * - The error classes form the documented hierarchy, and `edfErrorKind` — not `instanceof` —
 *   is the supported discriminator, because `instanceof` is false across a realm boundary.
 * - `VERSION` equals the version in `package.json`. The linkage is real rather than asserted:
 *   `package.json` is read as raw text at transform time, so it works in the Node project and
 *   the browser project alike, with no `fs` and no network.
 * - Nothing reachable from `src/index.ts` imports a Node built-in, transitively. The check walks
 *   the actual module graph from the source text, and proves it can detect one by finding the
 *   import in `src/node.ts` — the single module allowed to have it.
 */

import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import {
  BDF_ANNOTATIONS_LABEL,
  BDF_DIGITAL_MAX,
  BDF_DIGITAL_MIN,
  EDF_ANNOTATIONS_LABEL,
  EDF_DIGITAL_MAX,
  EDF_DIGITAL_MIN,
  EDF_HEADER_BLOCK_BYTES,
  EDF_RECOMMENDED_MAX_RECORD_BYTES,
  EdfAmbiguousChannelError,
  EdfBudgetError,
  EdfChannelNotFoundError,
  EdfError,
  EdfFormatError,
  EdfRangeError,
  EdfScalingError,
  EdfSourceError,
  isEdfError,
  TICKS_PER_SECOND,
  VERSION,
} from '../../src/index.js';

const api = edfcore as unknown as Readonly<Record<string, unknown>>;

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/**
 * A `class` has a non-writable `prototype` property; a function declaration does not. That is a
 * language guarantee rather than a heuristic, which is what makes "function vs class" testable.
 */
function isClass(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    Object.getOwnPropertyDescriptor(value, 'prototype')?.writable === false
  );
}

// ---------------------------------------------------------------------------
// Every symbol DESIGN section 3 lists for the "edfcore" entry
// ---------------------------------------------------------------------------

/** Free functions, in the three layers DESIGN section 3 groups them into. */
const FUNCTIONS: readonly string[] = [
  // I/O adapters
  'byteSource',
  'blobSource',
  'httpSource',
  'cachedSource',
  // Header model helpers
  'formatStartTimeNaive',
  // Diagnostics
  'formatDiagnostics',
  // Cross-realm error discrimination (DESIGN section 6: one spelling for the check)
  'isEdfError',
  // Primitives: pure, synchronous, zero I/O
  'parseHeader',
  'decodeDigital',
  'decodeAnnotations',
  'toPhysical',
  'clampToDigitalRange',
  'resolveTimeWindow',
  'trimToWindow',
  'findSignals',
  'getSignal',
  'decodeHeaderLatin1',
  'isAnnotationLabel',
  // I/O layer: thin, async, no caching
  'readHeader',
  'readRecordBytes',
  'buildTimeline',
  'buildRecordIndex',
  // Convenience layer
  'openEdf',
  'readRecords',
  'readWindow',
  'readAnnotations',
  'inspectEdf',
  // Helpers, added after the original barrel. Listing one here is not a formality: the
  // exhaustiveness test below refuses any export that is not named, which is what makes adding
  // one a deliberate act rather than something that quietly ships undocumented.
  'readEnvelope',
  'toPhysicalEnvelope',
  'envelopeOfSamples',
  'streamRecords',
  'getStatusSignal',
  'decodeStatusWord',
  'readTriggers',
  'filterAnnotationsByTime',
  'filterAnnotationsByText',
  'countAnnotationsByText',
  'sampleIndexAt',
  'sampleStartTicks',
  'sampleStartSeconds',
  'formatHeader',
  'matchSignals',
  'declaredDurationSeconds',
  'contiguityOf',
  'readEnvelopeAtResolution',
  'annotationsAt',
  'mergeChunks',
  'physicalRangeOf',
];

const ERROR_CLASSES: readonly string[] = [
  'EdfError',
  'EdfFormatError',
  'EdfScalingError',
  'EdfRangeError',
  'EdfSourceError',
  'EdfBudgetError',
  'EdfAmbiguousChannelError',
  'EdfChannelNotFoundError',
];

const CONSTANTS: readonly string[] = [
  'EDF_HEADER_BLOCK_BYTES',
  'EDF_ANNOTATIONS_LABEL',
  'BDF_ANNOTATIONS_LABEL',
  'EDF_RECOMMENDED_MAX_RECORD_BYTES',
  'TICKS_PER_SECOND',
  'EDF_DIGITAL_MIN',
  'EDF_DIGITAL_MAX',
  'BDF_DIGITAL_MIN',
  'BDF_DIGITAL_MAX',
  'VERSION',
];

describe('the barrel exports nothing that is not accounted for', () => {
  it('names every runtime export in one of the lists above', () => {
    /*
     * The lists above are an allowlist, and an allowlist only proves that what it names EXISTS.
     * Fifteen helpers were added across six releases and every one of them passed this file
     * untouched, which is also how they reached npm with no documentation.
     *
     * This is the other half: an export nobody listed is a failure. The cost of adding a symbol
     * is now one line here, and that line is the moment to ask whether it is documented.
     */
    const accounted = new Set([...FUNCTIONS, ...ERROR_CLASSES, ...CONSTANTS]);
    const runtimeExports = Object.keys(edfcore).filter((name) => name !== 'default');
    const unaccounted = runtimeExports.filter((name) => !accounted.has(name));
    expect(unaccounted).toEqual([]);
  });

  it('does not leak an internal helper into the barrel', () => {
    // gapBefore is exported from recording.ts so envelope.ts can share it. It is not API.
    expect(Object.keys(edfcore)).not.toContain('gapBefore');
  });
});

describe('the "edfcore" barrel exports every symbol DESIGN section 3 lists', () => {
  it.each(FUNCTIONS)('exports %s as a plain function', (name) => {
    expect(api[name]).toBeTypeOf('function');
    // A free function, not a class: DESIGN decision 5 is "zero classes except the error types".
    expect(isClass(api[name])).toBe(false);
  });

  it.each(ERROR_CLASSES)('exports %s as a class', (name) => {
    expect(api[name]).toBeTypeOf('function');
    expect(isClass(api[name])).toBe(true);
  });

  it.each(CONSTANTS)('exports %s as a constant, not a function', (name) => {
    expect(name in api).toBe(true);
    expect(api[name]).not.toBeTypeOf('function');
    expect(api[name]).not.toBeUndefined();
  });

  it('keeps the other two subpaths out of the universal entry', () => {
    // `validateHeader`/`validateRecording` are "edfcore/validate" and the file adapters are
    // "edfcore/node". DESIGN decision 15: three subpaths, no environment conditions.
    for (const name of ['validateHeader', 'validateRecording', 'fileSource', 'fileHandleSource']) {
      expect(name in api).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The error hierarchy
// ---------------------------------------------------------------------------

describe('the error classes', () => {
  interface ErrorCase {
    readonly name: string;
    readonly kind: string;
    readonly make: () => EdfError;
  }

  const cases: readonly ErrorCase[] = [
    {
      name: 'EdfFormatError',
      kind: 'format',
      make: () => new EdfFormatError('the file is wrong', { code: 'NOT_AN_EDF_FILE' }),
    },
    {
      name: 'EdfScalingError',
      kind: 'scaling',
      make: () =>
        new EdfScalingError('no scale', {
          code: 'DEGENERATE_DIGITAL_RANGE',
          signalIndex: 7,
          label: 'EMG Chin',
        }),
    },
    {
      name: 'EdfRangeError',
      kind: 'range',
      make: () =>
        new EdfRangeError('no such records', {
          requested: { start: 10, count: 1 },
          available: { start: 0, count: 4 },
        }),
    },
    {
      name: 'EdfSourceError',
      kind: 'source',
      make: () =>
        new EdfSourceError('short read', { offset: 0, requestedLength: 256, receivedLength: 12 }),
    },
    {
      name: 'EdfBudgetError',
      kind: 'budget',
      make: () => new EdfBudgetError('too big', { requiredBytes: 1_000, budgetBytes: 100 }),
    },
    {
      name: 'EdfAmbiguousChannelError',
      kind: 'channel',
      make: () =>
        new EdfAmbiguousChannelError('two matches', { label: 'T8-P8', matchingIndices: [4, 9] }),
    },
    {
      name: 'EdfChannelNotFoundError',
      kind: 'channel',
      make: () =>
        new EdfChannelNotFoundError('no match', { selector: 'Fp9', availableLabels: ['Fp1'] }),
    },
  ];

  it.each(cases)(
    '$name extends EdfError and carries edfErrorKind "$kind"',
    ({ name, kind, make }) => {
      const error = make();

      expect(error).toBeInstanceOf(EdfError);
      expect(error).toBeInstanceOf(Error);
      expect(defined(api[name], name)).toBe(error.constructor);
      expect(error.edfErrorKind).toBe(kind);
      // `name` comes from `new.target`, so a stack trace names the concrete class.
      expect(error.name).toBe(name);
      // The supported discriminator: `instanceof` is false across an iframe, a worker, or two
      // copies of the package in one tree, and `isEdfError` is the one spelling of the check.
      expect(isEdfError(error)).toBe(true);
    },
  );

  it('is false for anything edfcore did not throw', () => {
    expect(isEdfError(new Error('plain'))).toBe(false);
    expect(isEdfError(new RangeError('plain'))).toBe(false);
    expect(isEdfError(undefined)).toBe(false);
    expect(isEdfError({ edfErrorKind: 'format' })).toBe(true); // structural, and deliberately so
  });

  it('exposes the fields each class documents', () => {
    const budget = new EdfBudgetError('too big', { requiredBytes: 1_000, budgetBytes: 100 });
    expect(budget.requiredBytes).toBe(1_000);
    expect(budget.budgetBytes).toBe(100);
    expect(budget.optionName).toBe('maxMaterializeBytes');

    const ambiguous = new EdfAmbiguousChannelError('two matches', {
      label: 'T8-P8',
      matchingIndices: [4, 9],
    });
    expect(ambiguous.matchingIndices).toEqual([4, 9]);

    const range = new EdfRangeError('no such records', {
      requested: { start: 10, count: 1 },
      available: { start: 0, count: 4 },
    });
    expect(range.requested).toEqual({ start: 10, count: 1 });
    expect(range.available).toEqual({ start: 0, count: 4 });
  });

  it('makes every concrete class a subclass of EdfError structurally', () => {
    for (const name of ERROR_CLASSES) {
      const value = defined(api[name], name) as new (...args: never[]) => unknown;
      if (name === 'EdfError') {
        expect(value).toBe(EdfError);
        continue;
      }
      expect(value.prototype).toBeInstanceOf(EdfError);
    }
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('the exported constants', () => {
  it('pins the tick resolution at 100 ns, as a bigint', () => {
    // DESIGN "Time comparison": exact bigint 100 ns ticks in the public API, not only
    // internally, because float `==` on event times is how ERP alignment silently breaks.
    expect(TICKS_PER_SECOND).toBe(10000000n);
    expect(typeof TICKS_PER_SECOND).toBe('bigint');
  });

  it('pins the digital bounds at the two-s-complement limits of each sample width', () => {
    // EDF: 16-bit. BDF: 24-bit, sign-extended from bit 23 (DESIGN section 5, data records).
    expect(EDF_DIGITAL_MIN).toBe(-(2 ** 15));
    expect(EDF_DIGITAL_MAX).toBe(2 ** 15 - 1);
    expect(EDF_DIGITAL_MIN).toBe(-32768);
    expect(EDF_DIGITAL_MAX).toBe(32767);

    expect(BDF_DIGITAL_MIN).toBe(-(2 ** 23));
    expect(BDF_DIGITAL_MAX).toBe(2 ** 23 - 1);
    expect(BDF_DIGITAL_MIN).toBe(-8388608);
    expect(BDF_DIGITAL_MAX).toBe(8388607);
  });

  it('pins the annotation labels as the trimmed, case-sensitive text', () => {
    // On disk the field is `'EDF Annotations '` — 15 characters plus the pad. The constant is
    // the trimmed form, because that is what the label is matched against.
    expect(EDF_ANNOTATIONS_LABEL).toBe('EDF Annotations');
    expect(EDF_ANNOTATIONS_LABEL).toHaveLength(15);
    expect(BDF_ANNOTATIONS_LABEL).toBe('BDF Annotations');
  });

  it('pins the header block size and the recommended record size', () => {
    expect(EDF_HEADER_BLOCK_BYTES).toBe(256);
    expect(EDF_RECOMMENDED_MAX_RECORD_BYTES).toBe(61440);
  });
});

// ---------------------------------------------------------------------------
// VERSION against package.json, and the node:-free module graph
// ---------------------------------------------------------------------------

/**
 * `import.meta.glob(..., { query: '?raw' })` is resolved at transform time by the bundler, so
 * these tests read files without `fs` and run unchanged in the browser project.
 */
interface RawModuleGlob {
  glob: (pattern: string, options: Record<string, unknown>) => Record<string, string>;
}

const PACKAGE_JSON_SOURCE = (import.meta as unknown as RawModuleGlob).glob('../../package.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SRC_SOURCES = (import.meta as unknown as RawModuleGlob).glob('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Keyed by repo-relative path, e.g. `src/io/read.ts`. */
const MODULES = new Map<string, string>(
  Object.entries(SRC_SOURCES).map(([path, source]) => [path.replace(/^(?:\.\.\/)+/, ''), source]),
);

/**
 * The specifier of an `import`/`export ... from '...'`, or a bare side-effect import.
 *
 * Matched per line and anchored, so the prose in edfcore's own doc comments — which contains
 * the words "taken from" inside string literals — cannot be mistaken for an import.
 */
const IMPORT_FROM = /^\s*(?:import|export|\})[^'"]*\bfrom\s+'([^']+)';/;
const SIDE_EFFECT_IMPORT = /^\s*import\s+'([^']+)';/;

function specifiersOf(source: string): readonly string[] {
  const specifiers: string[] = [];
  for (const line of source.split('\n')) {
    const match = IMPORT_FROM.exec(line) ?? SIDE_EFFECT_IMPORT.exec(line);
    const specifier = match?.[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

/** `./x.js` and `../y/z.js` against the importing module's directory; `.js` maps back to `.ts`. */
function resolveSpecifier(fromModule: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const segments = fromModule.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/').replace(/\.js$/, '.ts');
}

function reachableFrom(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const module = queue.pop();
    if (module === undefined || seen.has(module)) continue;
    seen.add(module);
    const source = MODULES.get(module);
    if (source === undefined) continue;
    for (const specifier of specifiersOf(source)) {
      const resolved = resolveSpecifier(module, specifier);
      if (resolved !== undefined && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

describe('VERSION', () => {
  it('equals the version in package.json', () => {
    const raw = defined(Object.values(PACKAGE_JSON_SOURCE)[0], 'the raw package.json text');
    const manifest = JSON.parse(raw) as { readonly version?: unknown };

    expect(typeof manifest.version).toBe('string');
    expect(VERSION).toBe(manifest.version);
    expect(typeof VERSION).toBe('string');
  });
});

describe('the universal entry point', () => {
  it('found the module graph it is about to assert over', () => {
    // A vacuous walk would make every assertion below pass for the wrong reason.
    expect(MODULES.has('src/index.ts')).toBe(true);
    expect(MODULES.has('src/node.ts')).toBe(true);
    expect(MODULES.size).toBeGreaterThan(20);
  });

  it('reaches the modules the barrel re-exports, and not the other two subpaths', () => {
    const reachable = reachableFrom('src/index.ts');

    for (const module of [
      'src/index.ts',
      'src/errors.ts',
      'src/constants.ts',
      'src/header/parse.ts',
      'src/decode/digital.ts',
      'src/tal/annotations.ts',
      'src/time/window.ts',
      'src/io/http.ts',
      'src/record-index.ts',
      'src/recording.ts',
      'src/inspect.ts',
    ]) {
      expect(reachable.has(module)).toBe(true);
    }

    // `edfcore/node` and `edfcore/validate` are their own entries and are not pulled in here.
    expect(reachable.has('src/node.ts')).toBe(false);
    expect(reachable.has('src/validate.ts')).toBe(false);
  });

  it('resolves every relative specifier in that graph, so no edge is silently missed', () => {
    const unresolved: string[] = [];
    for (const module of reachableFrom('src/index.ts')) {
      for (const specifier of specifiersOf(defined(MODULES.get(module), module))) {
        if (!specifier.startsWith('.')) continue;
        const resolved = resolveSpecifier(module, specifier);
        if (resolved === undefined || !MODULES.has(resolved)) {
          unresolved.push(`${module} -> ${specifier}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('imports no Node built-in anywhere in that graph, transitively', () => {
    const offenders: string[] = [];
    for (const module of reachableFrom('src/index.ts')) {
      for (const specifier of specifiersOf(defined(MODULES.get(module), module))) {
        if (specifier.startsWith('node:')) offenders.push(`${module} -> ${specifier}`);
      }
    }

    // DESIGN decision 15: one universal build, no environment conditions in the exports map.
    // A `node:` specifier here would break the browser build and the Vite smoke test with it.
    expect(offenders).toEqual([]);
  });

  it('proves the check can see a Node built-in, by finding the one in edfcore/node', () => {
    // Without this the assertion above would pass just as happily against a broken detector.
    const nodeEntry = defined(MODULES.get('src/node.ts'), 'src/node.ts');
    const builtins = specifiersOf(nodeEntry).filter((specifier) => specifier.startsWith('node:'));

    expect(builtins).toEqual(['node:fs/promises']);
  });
});
