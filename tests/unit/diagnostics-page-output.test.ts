/**
 * What `diagnostics.md` prints for one header, printed.
 *
 * The page introduces the two ways of looking at a diagnostics array by showing both on the same
 * file: `formatDiagnostics` renders one entry in full, five detail lines and all, and
 * `summarizeDiagnostics` reduces the same four diagnostics to `total 4, errors 1, warnings 1,
 * infos 2`. Neither transcript was run. `diagnostics.test.ts` covers the vocabulary and the sink,
 * `diagnostic-message-lines.test.ts` the line discipline, and `summarize-diagnostics.test.ts` the
 * counting rules — all against fixtures of their own.
 *
 * The rendered block is the one worth comparing whole. It is what a user pastes into an issue, and
 * every part of it is load-bearing in a different way: the severity and code a reader greps for,
 * the wrapped message, the byte offset they take to a hex editor, the raw bytes as written, the
 * expected/actual pair, and the spec clause. A change to any one of them leaves the page showing
 * output the library no longer produces, and the page is the only place the whole shape appears.
 *
 * The paragraph under it makes four smaller claims, checked with it because each is the kind a
 * caller builds on: the output carries no ANSI escapes "unless you ask"; `color` adds them;
 * `maxItems` "caps the blocks rendered and appends a dimmed `... and N more`"; and
 * `formatDiagnostics([])` returns the empty string "rather than a blank line, so it concatenates
 * into a larger report cleanly".
 *
 * The fixture is built to the page's own numbers rather than to a convenient shape: one error, one
 * warning and two infos is what the summary transcript says, and the two infos come from two
 * different codes because `byCode` is printed beside them.
 *
 * What this does NOT check: the hex-dump line, which is `hex-dump.test.ts`, or the counting rules
 * themselves.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('diagnostics.md') ?? '';
const PROSE = PAGE.replace(/\s+/g, ' ');

/**
 * Four diagnostics: one error, one warning, two infos, which is what the summary transcript says.
 * The two infos are different codes, because `byCode` is printed beside the counts.
 */
const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  raw: { reserved: 'ZZZ' },
  signals: [
    {
      label: 'EEG Fpz-Cz',
      samplesPerRecord: 4,
      // A negative amplifier gain: legal, sanctioned by the EDF FAQ, and reported as info.
      raw: { physicalMinimum: '100', physicalMaximum: '-100' },
    },
    {
      label: 'Temp rectal',
      samplesPerRecord: 4,
      raw: { digitalMinimum: '0', digitalMaximum: '0' },
    },
  ],
});

async function diagnostics(): Promise<readonly EdfDiagnostic[]> {
  return (await openEdf(byteSource(BYTES))).header.diagnostics;
}

describe('the rendered block', () => {
  /** The fenced text block that begins with the degenerate-range entry. */
  const PRINTED = /```text\n(error \[DEGENERATE_DIGITAL_RANGE\][\s\S]*?)```/.exec(PAGE)?.[1] ?? '';

  it('is on the page in full, so a passing run is not a vacuous one', () => {
    expect(PRINTED).not.toBe('');
    // The entry, hard-wrapped by the page, then the five indented details under it.
    const lines = PRINTED.trimEnd().split('\n');
    expect(lines.filter((line) => line.startsWith('  '))).toHaveLength(5);
    expect(lines.length).toBeGreaterThan(6);
    for (const detail of ['  at byte offset', '  raw:', '  expected:', '  actual:', '  spec:']) {
      expect(PRINTED).toContain(detail);
    }
  });

  it('is what formatDiagnostics renders, line for line', async () => {
    const only = (await diagnostics()).filter(
      (diagnostic) => diagnostic.code === 'DEGENERATE_DIGITAL_RANGE',
    );
    expect(only).toHaveLength(1);
    // The page hard-wraps the message; the wrap is the page's, not the formatter's.
    const flatten = (text: string): string =>
      text
        .replace(/\n(?! )/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    expect(flatten(formatDiagnostics(only))).toBe(flatten(PRINTED));
  });
});

describe('the four claims under it', () => {
  /** The escape byte, built rather than embedded: a literal one in this file is invisible. */
  const ESC = String.fromCharCode(27);

  it('carries no ANSI escapes unless you ask', async () => {
    expect(formatDiagnostics(await diagnostics()).includes(ESC)).toBe(false);
    expect(PROSE).toContain('no ANSI escapes unless you ask');
  });

  it('adds them when you do', async () => {
    const rendered = formatDiagnostics(await diagnostics(), { color: true });
    expect(rendered.includes(`${ESC}[`)).toBe(true);
    // Stripped of them, it is the same text: colour is decoration, not content.
    const stripped = rendered
      .split(ESC)
      .map((piece, index) => (index === 0 ? piece : piece.replace(/^\[\d+m/, '')))
      .join('');
    expect(stripped).toBe(formatDiagnostics(await diagnostics()));
  });

  it('caps the blocks at maxItems and appends the count of the rest', async () => {
    const all = await diagnostics();
    const capped = formatDiagnostics(all, { maxItems: 1 });
    const entries = capped.split('\n').filter((line) => /^(?:error|warning|info) \[/.test(line));
    expect(entries).toHaveLength(1);
    expect(capped.trimEnd().endsWith(`... and ${all.length - 1} more`)).toBe(true);
  });

  it('dims that line when colour is on, which is the word the page uses', async () => {
    const capped = formatDiagnostics(await diagnostics(), { maxItems: 1, color: true });
    const last = capped.trimEnd().split('\n').at(-1) ?? '';
    // 2 is the SGR code for faint; 0 resets.
    expect(last.startsWith(`${ESC}[2m`)).toBe(true);
    expect(last.endsWith(`${ESC}[0m`)).toBe(true);
    expect(PROSE).toContain('appends a dimmed `... and N more`');
  });

  it('returns the empty string for an empty list, not a blank line', async () => {
    expect(formatDiagnostics([])).toBe('');
    expect(formatDiagnostics([], { color: true, maxItems: 20 })).toBe('');
    // "so it concatenates into a larger report cleanly" — the point of '' over a newline.
    expect(`head${formatDiagnostics([])}tail`).toBe('headtail');
  });
});

describe('the summary transcript', () => {
  /** `summary.total;      // 4` -> 4. */
  const shows = (field: string): number =>
    Number(new RegExp(`summary\\.${field};\\s+// (\\d+)`).exec(PAGE)?.[1] ?? Number.NaN);

  it('states four counts, so a passing run is not a vacuous one', () => {
    expect([shows('total'), shows('errors'), shows('warnings'), shows('infos')]).toEqual([
      4, 1, 1, 2,
    ]);
  });

  it('is what summarizeDiagnostics reports for a header with that mix', async () => {
    const summary = summarizeDiagnostics(await diagnostics());
    expect(summary.total).toBe(shows('total'));
    expect(summary.errors).toBe(shows('errors'));
    expect(summary.warnings).toBe(shows('warnings'));
    expect(summary.infos).toBe(shows('infos'));
    expect(summary.worst).toBe('error');
    expect(PAGE).toContain("summary.worst;      // 'error'");
  });

  it('gives byCode the shape the page prints, one entry per distinct code', async () => {
    const summary = summarizeDiagnostics(await diagnostics());
    expect(PAGE).toContain('[{ code, severity, count }, ...] most frequent first');
    expect(summary.byCode.map((entry) => Object.keys(entry).sort())).toEqual(
      summary.byCode.map(() => ['code', 'count', 'severity']),
    );
    expect(summary.byCode).toHaveLength(4);
    expect(summary.byCode.reduce((total, entry) => total + entry.count, 0)).toBe(summary.total);
  });
});
