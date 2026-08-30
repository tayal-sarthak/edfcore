/**
 * The default print cap, at all four places it is applied.
 *
 * `cli-limit-default.test.ts` covers the number: twenty, and the four documents that say so. Its
 * own docblock names the failure that made `DEFAULT_ITEM_LIMIT` a constant in 0.4.390 — the
 * literal `20` at four separate call sites, "`header` printing twenty diagnostics while
 * `events --list` prints fifty, with both pages still saying twenty" — and then exercises ONE of
 * the four. `events --list` is the site it counts. The three that the sentence is actually about
 * were never run with the flag left off.
 *
 * They are not reachable by accident, which is why: each needs a file with more than twenty of one
 * particular kind of diagnostic in one particular place, and the three places are different
 * arrays reached by different code. `header` prints `header.diagnostics` and then, separately,
 * `recording.timeline.diagnostics` under "From the record probes:" — a second application of the
 * same local, added in 0.3.94, that no test distinguishes from the first. `validate` prints
 * `report.diagnostics` through `formatValidationReport`, which is a different formatter with its
 * own `maxItems`. So the fixtures below are built for the purpose: thirty signals that each
 * declare `physicalMinimum == physicalMaximum`, thirty annotation signals each carrying a
 * malformed slot-0 TAL that both record probes see, and a malformed TAL in every one of forty
 * records.
 *
 * The four sites are enumerated out of `cli-run.ts` so a fifth fails here until it is driven, and
 * every count below is compared against the cap the CLI was observed to apply rather than against
 * a literal `20` — this file states the number nowhere, for the same reason the other one states
 * it in exactly one place.
 *
 * What this does NOT check: the number itself, or the four documents that promise it. That is
 * `cli-limit-default.test.ts`, and this file would keep passing if the cap changed to fifty
 * everywhere — which is the point. It checks that they move together.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf } from '../support/writer.js';

const CLI_SOURCE = readFileSync(new URL('../../src/cli-run.ts', import.meta.url), 'utf8');

/** Thirty degenerate scales, one `DEGENERATE_PHYSICAL_RANGE` on `header.diagnostics` each. */
const MANY_HEADER_DIAGNOSTICS = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: Array.from({ length: 30 }, (_, index) => ({
    label: `Fp${index}`,
    samplesPerRecord: 2,
    raw: { physicalMinimum: '5', physicalMaximum: '5' },
  })),
  annotationSignals: [{ samplesPerRecord: 16 }],
});

/**
 * Thirty annotation signals, each with a malformed TAL in slot 0. `openEdf` probes record 0 and
 * the last record, so this is sixty `TAL_MALFORMED` on `timeline.diagnostics` — the array the
 * second application prints, and one a caller reaches without asking for a scan.
 */
const MANY_PROBE_DIAGNOSTICS = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
  annotationSignals: Array.from({ length: 30 }, () => ({
    samplesPerRecord: 32,
    tals: () => [{ onset: '+1x', texts: ['e'] }],
  })),
});

/** A malformed TAL in every record, so the sweep has more to report than the cap admits. */
const MANY_SWEEP_DIAGNOSTICS = buildEdf({
  plus: 'C',
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
  annotationSignals: [{ samplesPerRecord: 40, tals: () => [{ onset: '+1x', texts: ['e'] }] }],
});

/** Sixty events, the fixture shape `cli-limit-default.test.ts` uses for the fourth site. */
const MANY_EVENTS = buildEdf({
  plus: 'C',
  recordCount: 60,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (record) => [{ onset: record + 0.5, texts: [`event ${record}`] }],
    },
  ],
});

async function invoke(argv: readonly string[], bytes: Uint8Array): Promise<string> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(bytes),
    out: (text) => {
      out += text;
    },
    err: () => undefined,
  };
  await runCli(parseArgs(argv), io);
  return out;
}

/** One printed diagnostic begins a line with its severity and code. Details are indented. */
const diagnosticsIn = (text: string): number =>
  text.split('\n').filter((line) => /^(?:error|warning|info) \[[A-Z0-9_]+]/.test(line)).length;

/** `header` prints its own diagnostics, then the probe's under a heading. Split on the heading. */
function sections(headerOutput: string): { own: string; probes: string } {
  const marker = '\nFrom the record probes:\n';
  const at = headerOutput.indexOf(marker);
  return at === -1
    ? { own: headerOutput, probes: '' }
    : { own: headerOutput.slice(0, at), probes: headerOutput.slice(at + marker.length) };
}

/**
 * The cap the CLI applies when `--limit` is absent, counted rather than declared. Every assertion
 * below compares against this, so the file names no number of its own.
 */
async function observedCap(): Promise<number> {
  const out = await invoke(['events', 'night.edf', '--list'], MANY_EVENTS);
  return out.split('\n').filter((line) => line.includes('\tevent ')).length;
}

describe('the sites that apply it', () => {
  it('are the four in cli-run.ts, found by reading it', () => {
    // Two `maxItems: limit` inside `header`, one `maxItems: args.limit ?? …` inside `validate`,
    // and the `slice` inside `events`. A fifth has to be driven below before this may grow.
    const capped = CLI_SOURCE.match(/maxItems: (?:limit|args\.limit \?\? DEFAULT_ITEM_LIMIT)/g);
    const sliced = CLI_SOURCE.match(/\.slice\(0, limit\)/g);
    expect(capped).toHaveLength(3);
    expect(sliced).toHaveLength(1);
  });

  it('all read the same constant, so none of them is a literal again', () => {
    const body = CLI_SOURCE.slice(CLI_SOURCE.indexOf('switch (command)'));
    expect(body.match(/args\.limit \?\? DEFAULT_ITEM_LIMIT/g)).toHaveLength(4);
    // The bug this replaced: a bare 20 standing in for the cap at one of them.
    expect(body).not.toMatch(/args\.limit \?\? 20\b/);
  });
});

describe('with no --limit given', () => {
  it('caps header diagnostics at the same number events --list is capped at', async () => {
    const cap = await observedCap();
    const { own } = sections(await invoke(['header', 'a.edf'], MANY_HEADER_DIAGNOSTICS));
    expect(diagnosticsIn(own)).toBe(cap);
    // And the file really had more, so the cap is what stopped it rather than the fixture.
    expect(own).toMatch(/\.\.\. and \d+ more/);
    expect(own).toContain('Raise --limit to see the rest.');
  });

  it('caps the record-probe diagnostics at it too, which is a second application of the same local', async () => {
    const cap = await observedCap();
    const { probes } = sections(await invoke(['header', 'a.edf'], MANY_PROBE_DIAGNOSTICS));
    expect(probes).not.toBe('');
    expect(diagnosticsIn(probes)).toBe(cap);
    expect(probes).toMatch(/\.\.\. and \d+ more/);
  });

  it('caps the validation report at it, through a different formatter', async () => {
    const cap = await observedCap();
    const out = await invoke(['validate', 'a.edf'], MANY_SWEEP_DIAGNOSTICS);
    expect(diagnosticsIn(out)).toBe(cap);
    expect(out).toMatch(/\.\.\. and \d+ more/);
    expect(out).toContain('Raise --limit to see the rest.');
  });

  it('caps an event listing at it, which is the site already covered', async () => {
    const cap = await observedCap();
    const out = await invoke(['events', 'night.edf', '--list'], MANY_EVENTS);
    expect(out.split('\n').filter((line) => line.includes('\tevent ')).length).toBe(cap);
  });
});

describe('and an explicit --limit reaches all four', () => {
  // Three is nobody's default, so a site that ignored `args.limit` and fell through to the
  // constant would print twenty here and fail — which no assertion above could catch.
  const THREE = ['--limit', '3'] as const;

  it('at the header diagnostics', async () => {
    const { own } = sections(await invoke(['header', 'a.edf', ...THREE], MANY_HEADER_DIAGNOSTICS));
    expect(diagnosticsIn(own)).toBe(3);
  });

  it('at the record probes', async () => {
    const { probes } = sections(
      await invoke(['header', 'a.edf', ...THREE], MANY_PROBE_DIAGNOSTICS),
    );
    expect(diagnosticsIn(probes)).toBe(3);
  });

  it('at the validation report', async () => {
    const out = await invoke(['validate', 'a.edf', ...THREE], MANY_SWEEP_DIAGNOSTICS);
    expect(diagnosticsIn(out)).toBe(3);
  });

  it('at the event listing', async () => {
    const out = await invoke(['events', 'night.edf', '--list', ...THREE], MANY_EVENTS);
    expect(out.split('\n').filter((line) => line.includes('\tevent ')).length).toBe(3);
  });
});
