/**
 * `inspectEdf` is `openEdf` without the probes — and its header is the same header.
 *
 * `diagnostics.md` calls `inspectEdf` "the first call" for an unfamiliar file and describes it as
 * triage: it reads at most 128 KiB, never throws about content, and returns `ok`, `variant`,
 * `header`, `byteLength`, `bytesRead`, `headerBytes` and a diagnostics list. Every one of those is
 * tested — `inspect-safety.test.ts` over bytes nobody chose, `inspect-validate.test.ts` on the
 * ceiling and on what it reports — and the relationship to the call it is triage FOR was not.
 *
 * That relationship is what a caller relies on. The point of running `inspectEdf` over a directory
 * is to decide which files are worth opening, and the decision is worthless if the header it shows
 * you is not the header you will get. So: over the eight `AWKWARD` shapes, wherever `inspectEdf`
 * returns a header it is compared field for field against `openEdf`'s, diagnostics included.
 *
 * `ok` is checked as the rule the page states rather than as a value — "true only when the header
 * parsed *and* carried no error-severity diagnostic" — against `summarizeDiagnostics` over the same
 * header, with both outcomes reached in the matrix so neither branch is untested.
 *
 * And `variant` is checked as the "separate best effort" the page says it is. The version block and
 * the reserved field are the first 8 and 44 bytes, and they "stay readable long after everything
 * else has stopped making sense": a file whose signal count is garbage has no header at all and is
 * still reported as `BDF+C`, or as `EDF+D`, rather than as nothing. That is the sentence the page
 * ends the section with, and nothing had run it.
 */

import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { setHeaderField } from '../support/corrupt.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('diagnostics.md') ?? '').replace(/\s+/g, ' ');

/** 128 KiB — `256 * 512`, the whole header of a 511-signal file. */
const CEILING = 256 * 512;

const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? `${member}n` : member,
  );

describe('wherever inspectEdf returns a header', () => {
  it('it is the header openEdf returns, field for field', async () => {
    let compared = 0;
    for (const file of AWKWARD) {
      const inspection = await inspectEdf(byteSource(file.bytes));
      if (inspection.header === undefined) continue;
      const opened = await openEdf(byteSource(file.bytes));
      expect(shape(inspection.header), file.name).toBe(shape(opened.header));
      compared += 1;
    }
    expect(compared).toBe(AWKWARD.length);
  });

  it('including the diagnostics, which is the part a triage pass is reading', async () => {
    for (const file of AWKWARD) {
      const inspection = await inspectEdf(byteSource(file.bytes));
      const opened = await openEdf(byteSource(file.bytes));
      // The inspection's own list is the header's, plus nothing: it never reads a record.
      expect(
        inspection.diagnostics.map((diagnostic) => diagnostic.code),
        file.name,
      ).toEqual(opened.header.diagnostics.map((diagnostic) => diagnostic.code));
    }
  });

  it('and names the same variant', async () => {
    for (const file of AWKWARD) {
      const inspection = await inspectEdf(byteSource(file.bytes));
      const opened = await openEdf(byteSource(file.bytes));
      expect(inspection.variant, file.name).toBe(opened.header.variant);
    }
  });
});

describe('ok is the rule the page states', () => {
  it('is true exactly when the header parsed and carried no error-severity diagnostic', async () => {
    expect(PAGE).toContain(
      '`ok` is true only when the header parsed *and* carried no error-severity diagnostic',
    );
    const outcomes = new Set<boolean>();
    for (const file of AWKWARD) {
      const inspection = await inspectEdf(byteSource(file.bytes));
      const parsed = inspection.header !== undefined;
      const errors =
        inspection.header === undefined
          ? -1
          : summarizeDiagnostics(inspection.header.diagnostics).errors;
      expect(inspection.ok, file.name).toBe(parsed && errors === 0);
      outcomes.add(inspection.ok);
    }
    // Both branches occur in the matrix, so neither is asserted about in the abstract.
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it('is false for a signal with no usable scale, though the header is perfectly readable', async () => {
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4, raw: { digitalMinimum: '0', digitalMaximum: '0' } },
      ],
    });
    const inspection = await inspectEdf(byteSource(bytes));
    expect(inspection.ok).toBe(false);
    expect(inspection.header).toBeDefined();
    expect(inspection.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'DEGENERATE_DIGITAL_RANGE',
    );
    // And it opens, which is the distinction the callout on the same page draws.
    await expect(openEdf(byteSource(bytes))).resolves.toBeDefined();
  });
});

describe('variant is a separate best effort', () => {
  it('survives a signal count that leaves no header at all', async () => {
    expect(PAGE).toContain('The `variant` is a separate best effort');
    expect(PAGE).toContain(
      "A file whose signal count is garbage is still reported as `'BDF'` rather than as nothing at all",
    );

    for (const [expected, bytes] of [
      [
        'BDF+C',
        buildEdf({
          format: 'BDF',
          plus: 'C',
          recordCount: 3,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
          annotationSignals: [{ samplesPerRecord: 20 }],
        }),
      ],
      [
        'EDF+D',
        buildEdf({
          plus: 'D',
          recordCount: 3,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
          annotationSignals: [{ samplesPerRecord: 20 }],
        }),
      ],
    ] as const) {
      const inspection = await inspectEdf(byteSource(setHeaderField(bytes, 'signalCount', 'xx  ')));
      expect(inspection.header, expected).toBeUndefined();
      expect(inspection.ok, expected).toBe(false);
      expect(inspection.variant, expected).toBe(expected);
      expect(
        inspection.diagnostics.map((diagnostic) => diagnostic.code),
        expected,
      ).toContain('SIGNAL_COUNT_INVALID');
    }
  });
});

describe('what it costs', () => {
  it('never exceeds the ceiling, on any of the shapes', async () => {
    for (const file of AWKWARD) {
      const inspection = await inspectEdf(byteSource(file.bytes));
      expect(inspection.bytesRead, file.name).toBeLessThanOrEqual(CEILING);
      expect(inspection.bytesRead, file.name).toBeGreaterThan(0);
      expect(inspection.byteLength, file.name).toBe(file.bytes.byteLength);
    }
  });

  it('and never exceeds what opening the same file costs, because it skips the probes', async () => {
    for (const file of AWKWARD) {
      const forInspect = spySource(byteSource(file.bytes));
      await inspectEdf(forInspect);
      const forOpen = spySource(byteSource(file.bytes));
      await openEdf(forOpen);
      expect(forInspect.bytesRead, file.name).toBeLessThanOrEqual(forOpen.bytesRead);
      expect(forInspect.reads.length, file.name).toBeLessThanOrEqual(forOpen.reads.length);
    }
  });
});
