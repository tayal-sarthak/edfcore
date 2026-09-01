/**
 * `edfcore json` reports what the record probes found, not only the header fields.
 *
 * `openEdf` reads record 0 and the last record and puts what it learned on
 * `recording.timeline.diagnostics`. 0.3.94 fixed `edfcore header` for dropping them and wrote down
 * exactly what it cost: "an EDF+C file with a real hole printed `1 diagnostic(s): 1 info` and never
 * mentioned `DISCONTINUITY_IN_CONTINUOUS_FILE`, while `edfcore gaps` on the same file reported a
 * 20-second hole". `edfcore json` had the same defect and kept it, on the same file, for the same
 * reason — its `diagnostics` came from `header.diagnostics` alone.
 *
 * It cost more here. This is the output a pipeline branches on, so
 * `select(.severity == "warning")` saw a clean file, and the command had already paid for the
 * probe: `spanSeconds` two keys up is computed from it, and on that file it reads 24 against four
 * records covering 4 s.
 *
 * `variant` is not a substitute and cannot be. `DISCONTINUITY_IN_CONTINUOUS_FILE` exists precisely
 * for the file whose reserved field says `EDF+C` while its onsets say otherwise, so the field a
 * script would check is the field that is wrong.
 *
 * `source` is on every entry rather than a second array, because a consumer filtering by severity
 * wants one array — and it keeps the distinction `edfcore header` makes by printing the probe's
 * findings under their own heading.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

interface Entry {
  readonly code: string;
  readonly severity: string;
  readonly source: string;
}

/** The reserved field says continuous; the onsets say there is a twenty-second hole. */
const LIES_ABOUT_CONTINUITY = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 20),
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function run(command: string, bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => bytes,
  };
  await runCli(parseArgs([command, 'a.edf']), io);
  return chunks.join('');
}

const diagnosticsOf = async (bytes: Uint8Array): Promise<readonly Entry[]> =>
  (JSON.parse(await run('json', bytes)) as { diagnostics: readonly Entry[] }).diagnostics;

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a file that lies about being continuous', LIES_ABOUT_CONTINUITY],
];

describe('the fixture', () => {
  it('is the shape 0.3.94 was about, and a passing run is not a vacuous one', async () => {
    const recording = await openEdf(byteSource(LIES_ABOUT_CONTINUITY));
    expect(recording.header.variant).toBe('EDF+C');
    expect(recording.timeline.diagnostics.map((one) => one.code)).toContain(
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    );
    // The probe's finding is not among the header's, which is the whole reason it was missable.
    expect(recording.header.diagnostics.map((one) => one.code)).not.toContain(
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    );
    expect(AWKWARD).toHaveLength(13);
  });
});

describe('on that file', () => {
  it('json reports the discontinuity, which it used to drop', async () => {
    const codes = (await diagnosticsOf(LIES_ABOUT_CONTINUITY)).map((one) => one.code);
    expect(codes).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');
  });

  it('a pipeline filtering for warnings now sees one', async () => {
    const warnings = (await diagnosticsOf(LIES_ABOUT_CONTINUITY)).filter(
      (one) => one.severity === 'warning',
    );
    expect(warnings.map((one) => one.code)).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');
  });

  it('says which findings came from the probe, and which from the header', async () => {
    const entries = await diagnosticsOf(LIES_ABOUT_CONTINUITY);
    const probed = entries.filter((one) => one.source === 'recordProbe');
    expect(probed.map((one) => one.code)).toEqual(['DISCONTINUITY_IN_CONTINUOUS_FILE']);
    expect(entries.filter((one) => one.source === 'header').length).toBeGreaterThan(0);
  });

  it('agrees with the two commands that already reported it', async () => {
    expect(await run('header', LIES_ABOUT_CONTINUITY)).toContain(
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    );
    expect(await run('gaps', LIES_ABOUT_CONTINUITY)).toContain('1 gap in 4 records');
  });
});

describe.each(FILES)('for %s', (_name, bytes) => {
  it('json reports every diagnostic the library holds, from both places', async () => {
    const recording = await openEdf(byteSource(bytes));
    const expected = [
      ...recording.header.diagnostics.map((one) => ({
        code: one.code,
        severity: one.severity,
        source: 'header',
      })),
      ...recording.timeline.diagnostics.map((one) => ({
        code: one.code,
        severity: one.severity,
        source: 'recordProbe',
      })),
    ];
    expect(await diagnosticsOf(bytes)).toEqual(expected);
  });
});
