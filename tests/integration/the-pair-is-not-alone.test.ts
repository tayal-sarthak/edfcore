/**
 * `edfcore json` has had two measured hole-finders since 0.6.12, and three places said it had one.
 *
 * `cli.md` described the document's `spanSeconds`/`coveredSeconds` pair as "the only thing in the
 * document that finds a hole without believing the file's own `variant`". The sentence two lines
 * below it, in the same paragraph, is what makes that false: 0.6.12 added the record probes'
 * diagnostics, so an entry carrying `source: "recordProbe"` is a second answer arrived at by
 * reading records rather than by trusting the reserved field. `cli-run.ts` and
 * `json-says-what-it-covers.test.ts` carried the same sentence.
 *
 * It matters because of what a reader does with "the only". A script told the pair is the only
 * measured signal compares two numbers and stops — and the pair is a NET comparison over two
 * probes, which is exactly the thing that misses a gap an overlap cancels. The probe diagnostics
 * are per boundary. On a file marked continuous whose onsets fall into separate segments, both
 * fire; the pair is one subtraction that can come out at zero.
 *
 * So this file runs the corrected claim: the document carries both, they are both reachable
 * without believing `variant`, and there is a file where the diagnostic says more than the pair.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

interface Document {
  readonly variant: string;
  readonly spanSeconds: number;
  readonly coveredSeconds: number;
  readonly diagnostics: ReadonlyArray<{ code: string; severity: string; source: string }>;
}

const PAGE = DOCS_PAGES.get('cli.md') ?? '';

/** EDF+C by its reserved field, with a twenty-second hole in its onsets. */
const LIES_ABOUT_CONTINUITY = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 20),
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function report(bytes: Uint8Array): Promise<Document> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => bytes,
  };
  await runCli(parseArgs(['json', 'a.edf']), io);
  return JSON.parse(chunks.join('')) as Document;
}

const probed = (document: Document): readonly string[] =>
  document.diagnostics.filter((one) => one.source === 'recordProbe').map((one) => one.code);

describe('the page', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(PAGE).toContain('recordProbe');
    expect(PAGE.length).toBeGreaterThan(1000);
  });

  it('no longer calls the pair the only thing that finds a hole', () => {
    expect(PAGE).not.toContain('which is the only thing in');
  });

  it('names the second answer 0.6.12 added, and names its codes', () => {
    expect(PAGE).toContain('no longer the document');
    expect(PAGE).toContain('only measured answer');
    expect(PAGE).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');
    expect(PAGE).toContain('RECORD_ONSET_SPACING_VIOLATION');
  });
});

describe('on a file whose variant is wrong', () => {
  it('answers with the pair', async () => {
    const document = await report(LIES_ABOUT_CONTINUITY);
    expect(document.variant).toBe('EDF+C');
    expect(document.spanSeconds).not.toBe(document.coveredSeconds);
  });

  it('answers a second time, from the probes rather than the reserved field', async () => {
    const document = await report(LIES_ABOUT_CONTINUITY);
    expect(probed(document)).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');
  });
});

describe('on a file whose records overlap', () => {
  const bytes = AWKWARD.find((file) => file.name === 'records that overlap in time')?.bytes;

  it('is in the matrix', () => {
    expect(bytes).toBeDefined();
    expect(AWKWARD).toHaveLength(17);
  });

  it('names the overlap, which no subtraction of the pair spells out', async () => {
    const document = await report(bytes as Uint8Array);
    expect(probed(document)).toContain('RECORD_ONSET_SPACING_VIOLATION');
    // The pair says only that the two numbers disagree; the code says which way.
    expect(document.coveredSeconds).toBeGreaterThan(document.spanSeconds);
  });
});

describe('across the matrix', () => {
  it('carries probe diagnostics on some files and none on others', async () => {
    const codes = await Promise.all(
      AWKWARD.map(async (file) => probed(await report(file.bytes)).length),
    );
    expect(codes.some((count) => count > 0)).toBe(true);
    expect(codes.some((count) => count === 0)).toBe(true);
  });
});
