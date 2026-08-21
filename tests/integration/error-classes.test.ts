/**
 * The error-class table on `api-errors.md`, and the one distinction underneath it that bit.
 *
 * Seven classes, each with an `edfErrorKind`. That field is how a caller branches — `instanceof`
 * is false across a realm boundary, which the package says everywhere — so the table is the map
 * between the class you catch and the string you switch on. A class whose kind changed would
 * silently fall into a different branch of every consumer's handler.
 *
 * The distinction below the table is smaller and caused a visible bug. An error raised FROM a
 * diagnostic opens with its code in brackets, because the code is the first thing you want when
 * the message is all you have. `EdfDiagnostic.message` does not, because `formatDiagnostics`
 * renders the code from the field beside it. Prefixing `error.code` yourself when displaying a
 * diagnostic therefore prints it twice — which is exactly what the inspector on this site did
 * until 0.4.185.
 *
 * Both halves are checked here, because "one of these carries its code inline and the other does
 * not" is a convention, and a convention is what the next message quietly breaks.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import * as edfcore from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-errors.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

/** The `| class | edfErrorKind | thrown when |` rows. */
const ROWS = (() => {
  const at = PAGE.indexOf('| class | `edfErrorKind` | thrown when |');
  if (at === -1) throw new Error('api-errors.md no longer tabulates the error classes');
  const rows: { readonly name: string; readonly kind: string }[] = [];
  for (const line of PAGE.slice(at).split('\n')) {
    if (!line.startsWith('|')) break;
    // The kind is written `'format'` — backticks around a quoted string literal — so both go.
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replaceAll('`', '').replaceAll("'", ''));
    rows.push({ name: cells[0] ?? '', kind: cells[1] ?? '' });
  }
  return rows.slice(2);
})();

/** One thrown error per class, produced by the condition the table describes. */
const PRODUCE: ReadonlyMap<string, () => Promise<unknown>> = new Map([
  [
    'EdfFormatError',
    async () => {
      const bytes = buildEdf({
        recordCount: 2,
        recordDurationSeconds: 1,
        signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
        raw: { version: 'XX      ' },
      });
      await openEdf(byteSource(bytes));
    },
  ],
  [
    'EdfScalingError',
    async () => {
      const bytes = buildEdf({
        recordCount: 1,
        recordDurationSeconds: 1,
        signals: [{ label: 'D', samplesPerRecord: 1, digitalMinimum: 0, digitalMaximum: 0 }],
      });
      const { header } = await openEdf(byteSource(bytes));
      edfcore.toPhysical(header.signals[0] as never, new Int32Array([0]));
    },
  ],
  [
    'EdfRangeError',
    async () => {
      const recording = await openEdf(
        byteSource(
          buildEdf({
            recordCount: 2,
            recordDurationSeconds: 1,
            signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          }),
        ),
      );
      await readRecords(recording, { records: { start: 100, count: 5 }, signalIndices: [0] });
    },
  ],
  [
    'EdfSourceError',
    async () => {
      const bytes = buildEdf({
        recordCount: 2,
        recordDurationSeconds: 1,
        signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      });
      const inner = byteSource(bytes);
      const short = {
        byteLength: inner.byteLength,
        read: async (offset: number, length: number) =>
          (await inner.read(offset, length)).subarray(0, Math.max(0, length - 1)),
      };
      await openEdf(short);
    },
  ],
  [
    'EdfBudgetError',
    async () => {
      const recording = await openEdf(
        byteSource(
          buildEdf({
            recordCount: 40,
            recordDurationSeconds: 1,
            signals: [{ label: 'Fp1', samplesPerRecord: 64 }],
          }),
        ),
      );
      await readRecords(
        recording,
        { records: { start: 0, count: 40 }, signalIndices: [0] },
        { maxMaterializeBytes: 8 },
      );
    },
  ],
  [
    'EdfAmbiguousChannelError',
    async () => {
      const { header } = await openEdf(
        byteSource(
          buildEdf({
            recordCount: 1,
            recordDurationSeconds: 1,
            signals: [
              { label: 'Fp1', samplesPerRecord: 4 },
              { label: 'Fp1', samplesPerRecord: 4 },
            ],
          }),
        ),
      );
      edfcore.getSignal(header, 'Fp1');
    },
  ],
  [
    'EdfChannelNotFoundError',
    async () => {
      const { header } = await openEdf(
        byteSource(
          buildEdf({
            recordCount: 1,
            recordDurationSeconds: 1,
            signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          }),
        ),
      );
      edfcore.getSignal(header, 'nope');
    },
  ],
]);

async function thrownBy(name: string): Promise<Error & Record<string, unknown>> {
  const produce = PRODUCE.get(name);
  if (produce === undefined) throw new Error(`no fixture produces ${name}`);
  try {
    await produce();
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
  throw new Error(`${name} was not thrown`);
}

describe('the error class table', () => {
  it('lists the seven classes the package exports', () => {
    expect(ROWS).toHaveLength(7);
    for (const row of ROWS) {
      expect(Object.keys(edfcore), row.name).toContain(row.name);
    }
  });

  it('has a fixture for every row, so none is checked by assertion alone', () => {
    expect([...PRODUCE.keys()].sort()).toEqual(ROWS.map((row) => row.name).sort());
  });

  for (const row of ROWS) {
    it(`throws ${row.name} carrying edfErrorKind '${row.kind}'`, async () => {
      const error = await thrownBy(row.name);
      expect(error.name).toBe(row.name);
      expect(error.edfErrorKind).toBe(row.kind);
      // The field a consumer branches on has to survive `isEdfError`, which is the documented gate.
      expect(isEdfError(error)).toBe(true);
    });
  }

  it('gives the two channel errors the same kind, as the table says', () => {
    // Two rows, one kind: `'channel'` is about what went wrong, not about which class says so.
    const channel = ROWS.filter((row) => row.kind === 'channel');
    expect(channel.map((row) => row.name).sort()).toEqual([
      'EdfAmbiguousChannelError',
      'EdfChannelNotFoundError',
    ]);
  });
});

describe('which messages carry their code inline', () => {
  it('states the rule and names the bug it caused', () => {
    expect(FLAT).toContain('opens with its code in brackets');
    expect(FLAT).toContain('which is exactly what the inspector on this site did until 0.4.185');
  });

  it('opens a diagnostic-derived error with its bracketed code', async () => {
    const error = await thrownBy('EdfFormatError');
    expect(error.message).toMatch(/^\[[A-Z0-9_]+\]/);
    expect(error.message).toContain(`[${String(error.code)}]`);
  });

  it('leaves the code off the diagnostic message itself, so nothing prints it twice', async () => {
    const { header } = await openEdf(
      byteSource(
        minimalEdfPlus({
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [{ samplesPerRecord: 30 }],
        }),
      ),
    );
    expect(header.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of header.diagnostics) {
      expect(diagnostic.message, diagnostic.code).not.toMatch(/^\[[A-Z0-9_]+\]/);
    }
  });

  it('has formatDiagnostics render the code from the field beside it', () => {
    // Which is why the message does not carry one: the renderer supplies it.
    const rendered = edfcore.formatDiagnostics([
      {
        code: 'DATE_CLIPPED_TO_1985_2084',
        severity: 'info',
        message: 'a message with no code in it',
      } as never,
    ]);
    expect(rendered).toContain('DATE_CLIPPED_TO_1985_2084');
    expect(rendered).toContain('a message with no code in it');
  });
});
