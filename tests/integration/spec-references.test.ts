/**
 * Every diagnostic edfcore emits names the spec clause it comes from.
 *
 * `edf-format.md` closes with it, as the reason the page is worth reading beside the library:
 * "Every diagnostic edfcore emits names the clause it comes from, so a surprising message is
 * traceable back to one of those documents." It is the promise that turns a warning into something
 * a reader can adjudicate — `EDF+ additional specification 5` is checkable against a document, and
 * "digital maximum looks wrong" is not.
 *
 * Nothing held it. `specReference` is optional on `DiagnosticInit`, so omitting it is not a type
 * error and not a lint error, and most of the sixty-odd emission sites pass it positionally
 * through a helper — which is why a static scan of the object literals reports seven false
 * positives and cannot answer the question. So this asks the diagnostics themselves.
 *
 * The reach is stated rather than implied. Twenty-four of the forty-six codes are produced here:
 * nine targeted files for the header defects that need a specific pair of fields, and a bit-flip
 * sweep over the first 900 bytes of a well-formed EDF+ file for everything the header parser and
 * the validator find on damage. The other twenty-two need conditions a single fixture cannot
 * reach — an HTTP source, a corpus recording, a TAL region built to be wrong in one way. So this
 * demonstrates the claim across half the table and is not a proof over all of it, and the count is
 * asserted so the sweep cannot quietly stop reaching anything.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { flipBit } from '../support/corrupt.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const ONE_SIGNAL = { recordCount: 1, recordDurationSeconds: 1 } as const;

/** The header defects that need a particular pair of fields rather than a random byte. */
const TARGETED: readonly Uint8Array[] = [
  buildEdf({
    ...ONE_SIGNAL,
    signals: [{ label: 'A', samplesPerRecord: 4, digitalMinimum: 0, digitalMaximum: 0 }],
  }),
  buildEdf({
    ...ONE_SIGNAL,
    signals: [{ label: 'A', samplesPerRecord: 4, physicalMinimum: 0, physicalMaximum: 0 }],
  }),
  buildEdf({
    ...ONE_SIGNAL,
    signals: [{ label: 'A', samplesPerRecord: 4, digitalMinimum: 2047, digitalMaximum: -2048 }],
  }),
  buildEdf({
    ...ONE_SIGNAL,
    signals: [{ label: 'A', samplesPerRecord: 4, physicalMinimum: 500, physicalMaximum: -500 }],
  }),
  buildEdf({
    ...ONE_SIGNAL,
    signals: [{ label: 'A', samplesPerRecord: 4, physicalDimension: 'Filtered' }],
  }),
  buildEdf({
    ...ONE_SIGNAL,
    signals: [
      { label: 'A', samplesPerRecord: 4 },
      { label: 'A', samplesPerRecord: 4 },
    ],
  }),
  buildEdf({
    recordCount: 1,
    recordDurationSeconds: 0,
    signals: [{ label: 'A', samplesPerRecord: 4 }],
  }),
  buildEdf({
    ...ONE_SIGNAL,
    plus: 'D',
    signals: [{ label: 'A', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
  }),
  // A continuous file whose records are not where a continuous file's records are.
  buildEdf({
    recordCount: 3,
    recordDurationSeconds: 1,
    plus: 'C',
    signals: [{ label: 'A', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
    recordOnsetSeconds: (record: number) => record * 2,
  }),
];

const WELL_FORMED = minimalEdfPlus({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Resp', samplesPerRecord: 2 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** The header's own diagnostics plus the validator's, or nothing if the file will not open. */
async function diagnosticsOf(bytes: Uint8Array): Promise<readonly EdfDiagnostic[]> {
  try {
    const recording = await openEdf(byteSource(bytes));
    const report = await validateRecording(recording, { scanSamples: true });
    return [...recording.header.diagnostics, ...report.diagnostics];
  } catch {
    // A throw is not a diagnostic. `next-clause.test.ts` owns what those messages have to say.
    return [];
  }
}

/** Every diagnostic the targeted files and the sweep between them produce. */
async function collect(): Promise<readonly EdfDiagnostic[]> {
  const found: EdfDiagnostic[] = [];
  for (const bytes of TARGETED) found.push(...(await diagnosticsOf(bytes)));
  // The header of this file is 1024 bytes, so 900 lands inside it and in the first record.
  for (let offset = 0; offset < Math.min(WELL_FORMED.byteLength, 900); offset += 1) {
    for (const bit of [0, 3, 7]) {
      found.push(...(await diagnosticsOf(flipBit(WELL_FORMED, offset, bit))));
    }
  }
  return found;
}

describe('the claim the page closes with', () => {
  it('is still on the page', () => {
    expect((DOCS_PAGES.get('edf-format.md') ?? '').replace(/\s+/g, ' ')).toContain(
      'Every diagnostic edfcore emits names the clause it comes from',
    );
  });

  it('holds for every diagnostic these files produce', async () => {
    const unsourced = (await collect())
      .filter((entry) => (entry.specReference ?? '').trim() === '')
      .map((entry) => entry.code);
    expect([...new Set(unsourced)]).toEqual([]);
  });

  it('reaches the share of the table this file claims to reach', async () => {
    const codes = new Set((await collect()).map((entry) => entry.code));
    // Stated, not "some": a change that stopped the sweep reaching the header parser would
    // otherwise leave this passing over a handful of codes and reporting nothing.
    expect(codes.size).toBeGreaterThanOrEqual(24);
  });

  it('names a document rather than a feeling', async () => {
    // Each reference points at one of the three primary sources the page lists, or at the EDF
    // header layout itself. A free-text explanation would satisfy "not empty" and nothing else.
    const references = new Set(
      (await collect()).map((entry) => entry.specReference ?? '').filter((text) => text !== ''),
    );
    expect(references.size).toBeGreaterThan(5);
    for (const reference of references) {
      expect(reference, reference).toMatch(/^(EDF specification|EDF\+|EDF FAQ|BioSemi|EDF spec)/);
    }
  });
});
