/**
 * "`report.ok` is `severity !== 'error'` over a superset of `header.diagnostics`."
 *
 * The callout on `diagnostics.md` that stops a reader gating a read on the wrong number. It says
 * three things and each is a claim about behaviour: the validation report carries every diagnostic
 * the header carried and possibly more; `ok` is exactly "no error-severity diagnostic" over that
 * list; and a file with one unscalable signal has `errors > 0` AND `report.ok === false` AND reads
 * perfectly — which is the whole reason the callout exists.
 *
 * `diagnostic-docs.test.ts` checks the page still words it that way. Nothing ran it. The superset
 * half is the one that could rot silently: `validateRecording` builds its own list, so a header
 * diagnostic dropped on the way in makes the report describe a cleaner file than the header did,
 * and the report is the stricter of the two by construction — the direction nobody checks.
 *
 * The last clause is asserted on the file it is about. `AWKWARD` carries a signal with a degenerate
 * digital range, which is `error` severity, `ok === false`, and reads its samples back exactly.
 *
 * What this does NOT check: which extra diagnostics a scan adds. `validation-report.test.ts` owns those.
 * This checks that nothing is lost, and that `ok` is the sentence the page writes it as.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { byteSource, openEdf, readRecordBytes, summarizeDiagnostics } from '../../src/index.js';
// `validateRecording` lives behind the `edfcore/validate` entry point, not the universal barrel.
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PROSE = (DOCS_PAGES.get('diagnostics.md') ?? '').replace(/\s\s*/g, ' ');

/** Code, severity and message together: two diagnostics of one code are two entries. */
const identity = (diagnostic: { code: string; severity: string; message: string }): string =>
  `${diagnostic.severity} [${diagnostic.code}] ${diagnostic.message}`;

describe('the page still makes the claim', () => {
  it('says ok is severity over a superset of the header diagnostics', () => {
    expect(PROSE).toContain("It is `severity !== 'error'` over a");
    expect(PROSE).toContain('superset of `header.diagnostics`');
  });
});

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  it(`reports a superset of the header, where ${awkward}`, async () => {
    const recording = await openEdf(byteSource(bytes));
    const report = await validateRecording(recording);

    const reported = new Set(report.diagnostics.map(identity));
    for (const diagnostic of recording.header.diagnostics) {
      expect(reported, `the report lost ${diagnostic.code}`).toContain(identity(diagnostic));
    }
    expect(report.diagnostics.length).toBeGreaterThanOrEqual(recording.header.diagnostics.length);
  });

  it(`sets ok to exactly "no error-severity diagnostic", where ${awkward}`, async () => {
    const recording = await openEdf(byteSource(bytes));
    const report = await validateRecording(recording);
    expect(report.ok).toBe(
      report.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    );
    // And the same sentence read through the summary, which is what a caller counts with.
    expect(report.ok).toBe(summarizeDiagnostics(report.diagnostics).errors === 0);
  });
});

describe('the file the callout is about', () => {
  it('has errors, is not ok, and reads perfectly', async () => {
    const file = AWKWARD.find((entry) => entry.name === 'a signal with no usable scale');
    expect(file, 'the fixture the callout is about is gone').toBeDefined();
    if (file === undefined) return;

    const recording = await openEdf(byteSource(file.bytes));
    const { header } = recording;

    // `errors > 0` on the header, and `report.ok === false` — the two numbers the callout warns
    // are both false-negatives for "can I read it".
    expect(summarizeDiagnostics(header.diagnostics).errors).toBeGreaterThan(0);
    expect((await validateRecording(recording)).ok).toBe(false);

    // And it reads. Nothing throws, and the samples are the ones the writer wrote — including
    // from the unscalable channel, which is the point of the deferred-fatal contract.
    const records = { start: 0, count: header.recordCount };
    const recordBytes = await readRecordBytes(recording.source, header, records);
    for (const signal of header.signals) {
      const digital = decodeDigital(header, recordBytes, records, signal.index);
      expect(digital).toHaveLength(signal.samplesPerRecord * header.recordCount);
    }
    expect(header.signals[0]?.scale).toBeUndefined();
    expect(header.signals[1]?.scale).toBeDefined();
  });
});

describe('the shapes reached both answers', () => {
  it('include one that validates ok and one that does not', async () => {
    const verdicts = await Promise.all(
      AWKWARD.map(
        async (file) => (await validateRecording(await openEdf(byteSource(file.bytes)))).ok,
      ),
    );
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the fifteen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(15);
  });
});
