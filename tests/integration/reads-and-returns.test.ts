/**
 * "It does not modify the recording, the header or the source ... call it twice and you get the
 * same report."
 *
 * `validation.md` says that of `validateRecording` and `diagnostics.md` says the neighbouring half
 * of it — the formatter output "is deterministic (no locale-sensitive formatting, no ANSI escapes
 * unless you ask), so it's safe to snapshot in a test". Both are properties of every read in the
 * package rather than of one call, and neither had a test: nothing in the suite calls anything
 * twice and compares, and nothing checks that a read leaves the header it was given alone.
 *
 * They are easy properties to lose and hard to notice losing. A parse that memoises a derived value
 * onto the header it returns, a formatter that sorts its input in place, a scan that fills in
 * `segments` on the index it was handed — each is a reasonable-looking optimisation, each makes the
 * second call disagree with the first, and none of them fails anything until a caller compares two
 * runs. The failure then looks like a file that changed.
 *
 * So both are swept over the whole shape matrix rather than asserted on one fixture. `AWKWARD` is
 * eight files chosen for what they break — a zero record duration, no data signal at all, duplicate
 * labels, a signal with no usable scale — and the sweep runs, for each of them: every read and
 * every formatter twice, comparing the results; the source's bytes before and after, comparing
 * them; and the header before and after, compared field by field through a walk that handles the
 * `bigint`s and the typed arrays `JSON.stringify` refuses.
 *
 * What this does NOT check: that two DIFFERENT files produce different output, or anything about
 * what the output says. Those are the per-page tests. This is only that running it again changes
 * nothing.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { formatValidationReport } from '../../src/format-report.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const VALIDATION = (DOCS_PAGES.get('validation.md') ?? '').replace(/\s+/g, ' ');
const DIAGNOSTICS = (DOCS_PAGES.get('diagnostics.md') ?? '').replace(/\s+/g, ' ');

/**
 * A structural rendering that survives what the header actually contains: `bigint` fields, typed
 * arrays of raw bytes, and `undefined` members that `JSON.stringify` would drop rather than
 * compare. Cycles are not possible here — a header is a tree — so depth is the only guard needed.
 */
function render(value: unknown, depth = 0): string {
  if (depth > 12) return '…';
  if (typeof value === 'bigint') return `${value}n`;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (ArrayBuffer.isView(value)) {
    const view = value as unknown as { length: number; [index: number]: number | bigint };
    const parts: string[] = [];
    for (let i = 0; i < view.length; i += 1) parts.push(String(view[i]));
    return `${value.constructor.name}(${parts.join(',')})`;
  }
  if (Array.isArray(value)) return `[${value.map((item) => render(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => typeof member !== 'function')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, member]) => `${key}:${render(member, depth + 1)}`).join(',')}}`;
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

const RECORDS = { start: 0, count: 1 } as const;

/** Everything this file runs twice. Each returns something `render` can compare. */
async function everything(recording: EdfRecording): Promise<readonly string[]> {
  const { header } = recording;
  const out: string[] = [];

  out.push(render(await validateRecording(recording)));
  out.push(render(await validateRecording(recording, { scanSamples: true })));
  out.push(render(await readAnnotations(recording, RECORDS)));
  out.push(render(await buildRecordIndex(recording)));

  if (header.dataSignalIndices.length > 0) {
    out.push(
      render(
        await readRecords(recording, {
          records: RECORDS,
          signalIndices: [...header.dataSignalIndices],
        }),
      ),
    );
  }

  const report = await validateRecording(recording, { scanSamples: true });
  const { annotations } = await readAnnotations(recording, RECORDS);
  out.push(formatHeader(header));
  out.push(formatHeader(header, { includePatientId: true, diagnosticsHint: false }));
  out.push(formatDiagnostics(header.diagnostics));
  out.push(formatDiagnostics(report.diagnostics, { maxItems: 3, color: true }));
  out.push(formatValidationReport(report, { header }));
  out.push(formatAnnotations(annotations, { includeChannel: true }));
  return out;
}

describe('the claim', () => {
  it('is on both pages, so a passing run is not a vacuous one', () => {
    expect(VALIDATION).toContain(
      'It does not modify the recording, the header or the source. `validateRecording` reads and returns; call it twice and you get the same report.',
    );
    expect(DIAGNOSTICS).toContain('The output is deterministic');
  });

  it('has a matrix wide enough to be worth sweeping', () => {
    expect(AWKWARD).toHaveLength(8);
  });
});

describe.each(AWKWARD.map((file) => [file.name, file] as const))('%s', (_name, file) => {
  it('gives the same answer the second time, from every call', async () => {
    const recording = await openEdf(byteSource(file.bytes));
    const first = await everything(recording);
    const second = await everything(recording);

    expect(first.length).toBeGreaterThan(8);
    expect(second).toEqual(first);
    // Not every entry is the empty string, which would make the comparison free.
    expect(first.filter((entry) => entry.length > 40).length).toBeGreaterThan(6);
  });

  it('leaves the header exactly as it found it', async () => {
    const recording = await openEdf(byteSource(file.bytes));
    const before = render(recording.header);
    await everything(recording);
    expect(render(recording.header)).toBe(before);
    // The rendering really did look at the file, rather than at an empty object.
    expect(before.length).toBeGreaterThan(500);
  });

  it('leaves the timeline and the index as it found them', async () => {
    const recording = await openEdf(byteSource(file.bytes));
    const before = render({ timeline: recording.timeline, index: recording.index });
    await everything(recording);
    expect(render({ timeline: recording.timeline, index: recording.index })).toBe(before);
    // A probed index stays probed: buildRecordIndex returns a new one rather than filling this in.
    expect(recording.index.coverage).toBe('probed');
  });

  it('leaves the source’s bytes untouched', async () => {
    const bytes = Uint8Array.from(file.bytes);
    const recording = await openEdf(byteSource(bytes));
    await everything(recording);
    expect(bytes).toEqual(file.bytes);
  });

  it('and a second recording over the same bytes agrees with the first', async () => {
    // The stronger form: not just idempotent on one object, but a function of the bytes.
    const first = await everything(await openEdf(byteSource(file.bytes)));
    const second = await everything(await openEdf(byteSource(Uint8Array.from(file.bytes))));
    expect(second).toEqual(first);
  });
});

describe('inspectEdf, which takes a source rather than a recording', () => {
  it.each(AWKWARD.map((file) => [file.name, file] as const))(
    'answers the same twice for %s',
    async (_name, file) => {
      const first = render(await inspectEdf(byteSource(file.bytes)));
      const second = render(await inspectEdf(byteSource(file.bytes)));
      expect(second).toBe(first);
      expect(first.length).toBeGreaterThan(200);
    },
  );
});
