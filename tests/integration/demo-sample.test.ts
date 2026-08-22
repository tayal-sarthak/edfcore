/**
 * The file the inspector hands a first-time visitor is one edfcore accepts.
 *
 * `website/src/scripts/sample-edf.ts` builds an EDF+C in the browser for the demo's "load a
 * sample recording", because shipping a file to download would undercut the one page whose whole
 * claim is that a recording never leaves the machine. It is written by hand from the
 * specification — 256-byte fixed header, field-major signal header, interleaved records, a
 * timekeeping TAL per record — and it is the only EDF writer in this repository that the test
 * suite never touched. `tests/support/writer.ts` is checked constantly; this one is checked by
 * whoever last loaded the demo.
 *
 * A drift there is the worst-placed defect on the site. The visitor clicks the one button the
 * page offers, and the inspector reports diagnostics about a file we wrote — which reads as
 * edfcore being wrong about a valid recording, on the page built to demonstrate the opposite.
 *
 * The generator is compiled rather than imported. `transform-boundary.test.ts` forbids reaching
 * into `website/` for anything but markdown: vite would resolve that file's nearest tsconfig,
 * which extends `astro/tsconfigs/strict` out of `website/node_modules`, and the CI check job
 * installs the root workspace only. `tsc` invoked on a named file reads no tsconfig at all, so
 * compiling it into a temporary directory and importing the emitted JavaScript stays on the
 * correct side of that rule for the same reason the rule exists.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Compiled at module scope, the way `documented-signatures.test.ts` spawns its compiler: starting
 * `tsc` costs a couple of seconds under a loaded suite, which is past the per-test timeout and is
 * a property of starting a compiler rather than of the check.
 */
const GENERATOR: string = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'edfcore-demo-sample-'));
  // The directory is outside the package, so `type: module` has to be stated for the emitted
  // file to load as ESM rather than as CommonJS.
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }');
  // The installed binary rather than `npx`, which spends four seconds resolving one that is
  // already here.
  execFileSync(
    join(ROOT, 'node_modules/.bin/tsc'),
    [
      'website/src/scripts/sample-edf.ts',
      '--outDir',
      dir,
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--lib',
      'ES2022,DOM',
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return pathToFileURL(join(dir, 'sample-edf.js')).href;
})();

const build = async (): Promise<Uint8Array> => {
  const module = (await import(GENERATOR)) as { buildSampleEdf: () => Uint8Array };
  return module.buildSampleEdf();
};

describe('the sample the demo generates', () => {
  it('opens as the recording the page says it is', async () => {
    const recording = await openEdf(byteSource(await build()));
    const { header } = recording;

    expect(header.variant).toBe('EDF+C');
    // Two minutes of one-second records, four channels and the annotation signal.
    expect(header.recordCount).toBe(120);
    expect(header.recordDurationSeconds).toBe(1);
    expect(header.dataSignalIndices).toHaveLength(4);
    expect(header.signals.map((signal) => signal.label)).toEqual([
      'EEG Fpz-Cz',
      'EOG horizontal',
      'EMG submental',
      'Resp nasal',
      'EDF Annotations',
    ]);
  });

  it('validates, and reports nothing an inspector would show as a problem', async () => {
    const recording = await openEdf(byteSource(await build()));
    const report = await validateRecording(recording);

    expect(report.ok).toBe(true);
    // One diagnostic, and it is the two-digit year every conforming EDF+ startdate carries.
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'DATE_CLIPPED_TO_1985_2084',
    ]);
    expect(report.diagnostics.every((diagnostic) => diagnostic.severity === 'info')).toBe(true);
    expect(report.recordsScanned).toBe(120);
  });

  it('carries the scored events the demo is there to show', async () => {
    const recording = await openEdf(byteSource(await build()));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 120 });

    expect(annotations.map((event) => event.text)).toEqual([
      'Sleep stage W',
      'Sleep stage N2',
      'K-complex',
      'Obstructive apnea',
      'Desaturation',
      'K-complex',
      'Sleep stage REM',
    ]);
    // The apnea is the one the respiratory channel flattens under, so its span is load-bearing
    // for the picture the demo draws.
    const apnea = annotations.find((event) => event.text === 'Obstructive apnea');
    expect(apnea?.onsetSecondsFromFirstRecord).toBe(70);
    expect(apnea?.durationSeconds).toBe(14);
  });

  it('decodes to physical values inside every declared range', async () => {
    const recording = await openEdf(byteSource(await build()));
    const indices = [...recording.header.dataSignalIndices];
    const [chunk] = await readWindow(recording, {
      startSeconds: 60,
      durationSeconds: 10,
      signalIndices: indices,
    });
    expect(chunk).toBeDefined();

    for (const [at, series] of (chunk?.signals ?? []).entries()) {
      const signal = recording.header.signals[indices[at] ?? 0];
      if (signal === undefined) throw new Error(`no signal at ${at}`);
      expect(series.digital.length).toBe(10 * signal.samplesPerRecord);

      // The generator clamps to int16 before writing, so nothing should come back outside the
      // range the header declares. One quantisation step of slack, because the round trip through
      // the digital grid is not the identity on the endpoints.
      const physical = toPhysical(signal, series.digital);
      const step = (signal.physicalMaximum - signal.physicalMinimum) / 65_535;
      for (const value of physical) {
        expect(value).toBeGreaterThanOrEqual(signal.physicalMinimum - step);
        expect(value).toBeLessThanOrEqual(signal.physicalMaximum + step);
      }
      // And it is a signal rather than a flat line, which a scale mistake would produce.
      expect(Math.max(...physical) - Math.min(...physical)).toBeGreaterThan(step * 10);
    }
  });
});
