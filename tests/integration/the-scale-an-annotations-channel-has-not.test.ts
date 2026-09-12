/**
 * Why `edfcore json` omits `scale` on an annotations signal, and whether the page says so.
 *
 * `cli.md` said the key "is absent when the header has no usable gain", and named the degenerate
 * cases: an inverted or degenerate range, the `Filtered` dimension. None of them is the case a
 * reader of that output meets. `signals.ts` builds no scale for an annotations channel at all —
 * "its bytes are TAL text, so there is no measurement to scale" — and an EDF+ writer declares that
 * channel `-1..1` over `-32768..32767`, which is a perfectly usable gain.
 *
 * So every EDF+ file emits annotation entries with no `scale` and a range that reads as fine, and
 * the page's one explanation for the missing key was a claim about the file being malformed
 * (fixed in 0.6.100).
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

interface JsonSignal {
  readonly index: number;
  readonly kind: string;
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
  readonly scale?: { readonly bitValue: number; readonly offset: number };
}

async function jsonSignals(): Promise<readonly JsonSignal[]> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(FILE),
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  expect(await runCli(parseArgs(['json', 'fixture.edf']), io)).toBe(0);
  return (JSON.parse(out) as { signals: readonly JsonSignal[] }).signals;
}

describe('the annotations entry in the json document', () => {
  it('has no scale', async () => {
    const annotations = (await jsonSignals()).filter((s) => s.kind === 'annotations');
    expect(annotations.length).toBeGreaterThan(0);
    for (const signal of annotations) expect(signal.scale).toBeUndefined();
  });

  it('declares a range that would have produced a perfectly usable one', async () => {
    // The point of the fix: nothing about these four numbers explains the missing key.
    for (const signal of (await jsonSignals()).filter((s) => s.kind === 'annotations')) {
      expect(signal.digitalMinimum).toBeLessThan(signal.digitalMaximum);
      expect(signal.physicalMinimum).toBeLessThan(signal.physicalMaximum);
    }
  });

  it('sits beside a data entry that does have one, so the omission is per signal', async () => {
    const data = (await jsonSignals()).filter((s) => s.kind === 'data');
    expect(data.length).toBeGreaterThan(0);
    for (const signal of data) expect(signal.scale?.bitValue).toBeGreaterThan(0);
  });
});

describe('the page that explains the missing key', () => {
  const page = DOCS_PAGES.get('cli.md') ?? '';

  it('was found, so a passing run is not a vacuous one', () => {
    expect(page).toContain('The key is absent when the header has no usable gain');
  });

  it('names the annotations channel as the case a reader actually meets', () => {
    const sentence = page.slice(page.indexOf('The key is absent'));
    expect(sentence.slice(0, 600)).toContain('annotations channel');
    expect(sentence.slice(0, 600)).toContain('TAL text');
  });
});
