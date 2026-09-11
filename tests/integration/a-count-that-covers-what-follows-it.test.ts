/**
 * `edfcore header`'s count line, against the number of entries printed under it.
 *
 * `formatHeader` ends with "2 diagnostics: 1 error, 1 info", counting `header.diagnostics`, and
 * follows it with "Call formatDiagnostics(header.diagnostics) for the detail." That hint is the
 * only thing on the line naming the scope — and `edfcore header` passes `diagnosticsHint: false`
 * to suppress it, because it is about to print the detail itself.
 *
 * It then prints TWO blocks: `header.diagnostics`, and `recording.timeline.diagnostics` under
 * "From the record probes:", which 0.3.94 added. So a file with two of each printed a count line
 * saying two and four entries beneath it, with nothing to say which two the count was about.
 * `cli-run.ts` asserted in a comment that the count line "is scoped honestly — it names
 * `header.diagnostics`". It does not; the hint did (fixed in 0.6.70).
 *
 * The first block is labelled "From the header:" when, and only when, a second one follows. On a
 * file with one block there is nothing to disambiguate and the output is unchanged, which is most
 * files — so the label means something when it appears.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf } from '../support/writer.js';

/** One degenerate scale (header) and one malformed slot-0 TAL both probes see (timeline). */
const BOTH = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 2, raw: { physicalMinimum: '5', physicalMaximum: '5' } },
  ],
  annotationSignals: [{ samplesPerRecord: 32, tals: () => [{ onset: '+1x', texts: ['e'] }] }],
});

/** Nothing for the probes to find, so only the header block is printed. */
const HEADER_ONLY = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 2, raw: { physicalMinimum: '5', physicalMaximum: '5' } },
  ],
});

async function headerOutput(bytes: Uint8Array): Promise<string> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(bytes),
    out: (text) => {
      out += text;
    },
    err: () => undefined,
  };
  await runCli(parseArgs(['header', 'a.edf']), io);
  return out;
}

const countLine = (out: string): string =>
  out.split('\n').find((line) => /^\d+ diagnostics?:/.test(line)) ?? '';

const entriesIn = (out: string): number =>
  out.split('\n').filter((line) => /^(?:error|warning|info) \[[A-Z0-9_]+]/.test(line)).length;

describe('a file with findings in both places', () => {
  it('prints more entries than the count line counts, which is why the labels exist', async () => {
    const out = await headerOutput(BOTH);
    expect(countLine(out)).toMatch(/^\d+ diagnostics?:/);
    expect(entriesIn(out)).toBeGreaterThan(Number(countLine(out).split(' ')[0]));
  });

  it('labels both blocks, so the count belongs to the one under its own heading', async () => {
    const out = await headerOutput(BOTH);
    expect(out).toContain('From the header:');
    expect(out).toContain('From the record probes:');
    expect(out.indexOf('From the header:')).toBeLessThan(out.indexOf('From the record probes:'));
  });

  it('puts the count line above the first label, not inside a block', async () => {
    const out = await headerOutput(BOTH);
    expect(out.indexOf(countLine(out))).toBeLessThan(out.indexOf('From the header:'));
  });
});

describe('a file with findings in one place', () => {
  it('labels nothing, because there is nothing to tell apart', async () => {
    const out = await headerOutput(HEADER_ONLY);
    expect(out).not.toContain('From the header:');
    expect(out).not.toContain('From the record probes:');
  });

  it('and the count line then covers every entry printed', async () => {
    const out = await headerOutput(HEADER_ONLY);
    expect(entriesIn(out)).toBe(Number(countLine(out).split(' ')[0]));
  });
});
