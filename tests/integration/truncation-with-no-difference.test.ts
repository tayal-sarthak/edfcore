/**
 * A truncated file whose record count is right, which `api-primitives.md` said cannot happen.
 *
 * The page's argument for why `sourceByteLength` is a required positional argument is a good one,
 * and one of its two reasons overstated itself: "A header declaring 2880 records over a file that
 * only holds 2879 whole ones is a truncated download. The difference between those two numbers is
 * the only evidence of it."
 *
 * It is not. A writer that flushes its record-count field as it goes — updating the header
 * periodically so a reader can follow the recording — and then dies mid-record leaves a file whose
 * declared count equals the whole records on disk, plus a fraction of one more after them.
 * `header/parse.ts` already handles that: `declared === wholeRecords` with bytes left over reports
 * `PARTIAL_FINAL_RECORD` rather than `TRAILING_BYTES`, because a partial record is not spare bytes.
 * The count is unaffected and `recordCountSource` stays `'headerField'`.
 *
 * The matrix's own `a download that stopped part way` is the other case and reports both codes at
 * once, which is what made the sentence look complete: a shape earning `TRUNCATED_FILE` also earns
 * `PARTIAL_FINAL_RECORD`, so the second one never appeared alone. It does here.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { AWKWARD } from '../support/awkward-files.js';
import { setHeaderField, truncateBy } from '../support/corrupt.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const WHOLE = buildEdf({
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 20 }],
});

/** Five whole records and 26 bytes of a sixth, with the header field already saying five. */
const FLUSHED_THEN_DIED = setHeaderField(truncateBy(WHOLE, 30), 'recordCount', '5');

/** The same cut, with the field left at six: the case the page describes. */
const DECLARED_MORE = truncateBy(WHOLE, 30);

const codes = (diagnostics: readonly EdfDiagnostic[]): readonly string[] =>
  diagnostics.map((one) => one.code);

const PAGE = DOCS_PAGES.get('api-primitives.md') ?? '';

describe('the page', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(PAGE).toContain('Detecting truncation');
  });

  it('no longer says the count difference is the only evidence', () => {
    expect(PAGE).not.toContain('The difference between those two numbers is the only evidence');
    expect(PAGE).toContain('PARTIAL_FINAL_RECORD');
  });
});

describe('when the declared count is larger than the file', () => {
  it('is the case the page describes, and reports both codes', async () => {
    const { header } = await openEdf(byteSource(DECLARED_MORE));
    expect(codes(header.diagnostics)).toContain('TRUNCATED_FILE');
    expect(codes(header.diagnostics)).toContain('PARTIAL_FINAL_RECORD');
    expect(header.recordCount).toBe(5);
    expect(header.recordCountSource).toBe('sourceByteLength');
  });
});

describe('when the declared count is exactly right', () => {
  it('still finds the truncation, with no difference to notice', async () => {
    const { header } = await openEdf(byteSource(FLUSHED_THEN_DIED));
    expect(codes(header.diagnostics)).toContain('PARTIAL_FINAL_RECORD');
    // Nothing to subtract: the field says five and five whole records are there.
    expect(codes(header.diagnostics)).not.toContain('TRUNCATED_FILE');
    expect(header.recordCount).toBe(5);
    expect(header.recordCountSource).toBe('headerField');
  });

  it('says how far into the next record the bytes stop', async () => {
    const { header } = await openEdf(byteSource(FLUSHED_THEN_DIED));
    const partial = header.diagnostics.find((one) => one.code === 'PARTIAL_FINAL_RECORD');
    expect(partial?.message).toContain('ends 26 bytes into data record 5');
    expect(partial?.actual).toBe('26 bytes');
  });

  it('is not trailing bytes, which is the other thing spare bytes can be', async () => {
    const { header } = await openEdf(byteSource(FLUSHED_THEN_DIED));
    expect(codes(header.diagnostics)).not.toContain('TRAILING_BYTES');
  });
});

describe('the matrix shape that hid it', () => {
  it('is the one that earns both, so the second never appeared alone before', async () => {
    expect(AWKWARD).toHaveLength(17);
    const bytes = AWKWARD.find((file) => file.name === 'a download that stopped part way')?.bytes;
    expect(bytes).toBeDefined();
    const { header } = await openEdf(byteSource(bytes as Uint8Array));
    expect(codes(header.diagnostics)).toContain('TRUNCATED_FILE');
    expect(codes(header.diagnostics)).toContain('PARTIAL_FINAL_RECORD');
  });
});
