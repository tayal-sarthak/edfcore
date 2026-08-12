/**
 * The browser claim, executed.
 *
 * The README supports Chrome 94+, Firefox 93+ and Safari 15.4+. Every one of the 1,900-odd tests
 * in this repository runs under vitest's `environment: 'node'`, where `process.env` and
 * `Buffer.from` work perfectly — so none of them could ever have caught the one mistake that
 * breaks all three browsers at once: a bare Node global.
 *
 * `public-api.test.ts` catches the importable half by walking the module graph for `node:`
 * specifiers. A global needs no import, so it passes that walk untouched.
 *
 * This runs the built universal bundle in a child process whose Node-only globals have been
 * replaced by getters that throw exactly as a browser does, and drives the public API through it.
 * It is not a browser, and it is not claimed to be one: it is the subset of "browser" that is
 * mechanically checkable here — which globals exist — run against the artifact that actually
 * ships.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { minimalEdfPlus } from '../support/writer.js';

interface Report {
  readonly trapped: readonly string[];
  readonly trapsBite: boolean;
  readonly touched: readonly string[];
  readonly findings: readonly string[];
  readonly results: Record<string, unknown>;
}

const DIST = new URL('../../dist/', import.meta.url);
const HARNESS = fileURLToPath(new URL('../support/browser-realm.mjs', import.meta.url));

const FIXTURE = minimalEdfPlus({
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    {
      label: 'EEG Fpz-Cz',
      samplesPerRecord: 16,
      physicalMinimum: -500,
      physicalMaximum: 500,
      digitalMinimum: -32768,
      digitalMaximum: 32767,
    },
  ],
});

function runInBrowserRealm(): Report {
  if (!existsSync(fileURLToPath(new URL('index.js', DIST)))) {
    // Deliberately a failure, not a skip. A skipped test here would restore the exact silence
    // this file exists to end.
    throw new Error(
      'dist/index.js is missing, so the browser realm has nothing to load. Next: run ' +
        '`npm run build` (`npm run check` builds before it tests for this reason).',
    );
  }

  const stdout = execFileSync(
    process.execPath,
    [HARNESS, Buffer.from(FIXTURE).toString('base64'), DIST.href],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const line = stdout.split('\n').find((text) => text.startsWith('EDFCORE_BROWSER_REALM '));
  if (line === undefined) throw new Error(`harness printed no report:\n${stdout}`);
  return JSON.parse(line.slice('EDFCORE_BROWSER_REALM '.length)) as Report;
}

// One child process, several assertions against its report.
const report = runInBrowserRealm();

describe('the harness can detect what it is looking for', () => {
  it('actually removed the Node globals it claims to have removed', () => {
    // Without this, a clean run would prove only that the traps never went up.
    expect(report.trapped).toContain('process');
    expect(report.trapped).toContain('Buffer');
    expect(report.trapsBite).toBe(true);
  });
});

describe('the universal build runs with browser globals only', () => {
  it('touches no Node global while parsing, reading, scaling and validating', () => {
    expect(report.touched).toEqual([]);
    expect(report.findings).toEqual([]);
  });

  it('produces the same answers it produces under Node', () => {
    // Not just "it did not throw": the numbers have to be the file's.
    expect(report.results).toMatchObject({
      variant: 'EDF+C',
      signalCount: 2,
      recordCount: 6,
      sampleCount: 6 * 16,
      buckets: 8,
      blobSignalCount: 2,
    });
    expect(report.results.physicalRange).toEqual({ low: -500, high: 500 });
    expect(report.results.headerText).toContain('EDF+C');
    expect(typeof report.results.firstPhysical).toBe('number');
  });

  it('still throws a typed EdfError, so isEdfError works off the Node path too', () => {
    expect(report.results.errorKind).toBe('format');
  });
});
