/**
 * `api-primitives.md`'s `maxItems` row, checked against what `formatDiagnostics` does.
 *
 * The row said "A non-finite value is ignored; `0` shows only the summary line". Both halves were
 * wrong, and each in a way a reader acts on:
 *
 * - 0.6.1 made `NaN` a refusal. `NaN` is non-finite, and it is the value the refusal exists for —
 *   `Number()` on an absent environment variable, query parameter or config key. The page told a
 *   caller that value would be quietly ignored, which is what `requireItemLimit` stopped doing.
 *   The same release made `-Infinity` show nothing rather than everything, which the row also
 *   contradicted.
 * - `formatDiagnostics` has no summary line. It renders one block per diagnostic and nothing else,
 *   so `maxItems: 0` leaves only the `... and N more` notice. The summary belongs to
 *   `formatValidationReport`, whose own row on `api-helpers.md` describes it correctly — which is
 *   where that clause appears to have come from.
 *
 * Fixed in 0.6.52. Every assertion below runs the function; the page is then read for the claim.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { parseHeader } from '../../src/header/parse.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('api-primitives.md') ?? '').replace(/\s+/g, ' ');

/** Two degenerate scales, so there is more than one block to cap. */
const FILE = buildEdf({
  recordCount: 1,
  recordDurationSeconds: 1,
  signals: [0, 1].map((index) => ({
    label: `Fp${index}`,
    samplesPerRecord: 2,
    raw: { physicalMinimum: '5', physicalMaximum: '5' },
  })),
});

// `FILE.byteLength`, not arithmetic. This said `512 + 2 * 2 * 2`, which is 520 for a file of 776 —
// the fixed header is 256 bytes and each of the three signals adds another — so every parse here
// also collected a TRUNCATED_FILE about a file that is whole. 0.6.202 refuses that pair outright.
const DIAGNOSTICS = parseHeader(FILE, FILE.byteLength).diagnostics;

const NOTICE = /\.\.\. and \d+ more/;

describe('what the function does with the awkward values', () => {
  it('has more than one diagnostic, so a cap can be observed at all', () => {
    expect(DIAGNOSTICS.length).toBeGreaterThan(1);
  });

  it('renders no blocks at all for 0, leaving the notice on its own', () => {
    const out = formatDiagnostics(DIAGNOSTICS, { maxItems: 0 });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(out).toMatch(NOTICE);
  });

  it('does the same for a negative, including -Infinity', () => {
    const zero = formatDiagnostics(DIAGNOSTICS, { maxItems: 0 });
    expect(formatDiagnostics(DIAGNOSTICS, { maxItems: -1 })).toBe(zero);
    expect(formatDiagnostics(DIAGNOSTICS, { maxItems: Number.NEGATIVE_INFINITY })).toBe(zero);
  });

  it('treats Infinity as no cap, which is omitting the option', () => {
    expect(formatDiagnostics(DIAGNOSTICS, { maxItems: Number.POSITIVE_INFINITY })).toBe(
      formatDiagnostics(DIAGNOSTICS, {}),
    );
  });

  it('refuses NaN rather than ignoring it, so "non-finite" covers two answers', () => {
    expect(() => formatDiagnostics(DIAGNOSTICS, { maxItems: Number.NaN })).toThrow(RangeError);
  });

  it('prints no summary line, so there is nothing for 0 to leave behind but the notice', () => {
    const whole = formatDiagnostics(DIAGNOSTICS, {});
    expect(whole.split('\n')[0]).toMatch(/^(?:error|warning|info) \[[A-Z0-9_]+]/);
    expect(whole).not.toMatch(/^\d+ diagnostics?:/m);
  });
});

describe('and what the page says about them', () => {
  it('no longer claims a non-finite value is ignored', () => {
    expect(PAGE).not.toContain('A non-finite value is ignored');
  });

  it('no longer claims this function has a summary line', () => {
    expect(PAGE).not.toContain('`0` shows only the summary line');
  });

  it('names the two answers non-finite covers', () => {
    const row = /\| `maxItems` \|[^|]*\|[^|]*\|([^|]*)\|/.exec(PAGE)?.[1] ?? '';
    expect(row).toContain('`Infinity`');
    expect(row).toContain('`NaN`');
  });
});
