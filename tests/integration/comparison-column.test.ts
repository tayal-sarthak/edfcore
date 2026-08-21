/**
 * The edfcore column of the capabilities table on `comparison.md`.
 *
 * Seven rows, and only one column this repository is entitled to check. The other four describe
 * packages nobody here controls, surveyed at a point in time, and the page is careful about that:
 * "Not established" means the survey did not verify it either way, and is "not a polite way of
 * writing 'no'". Asserting anything about them would be asserting about someone else's release
 * schedule. So the claim under test is narrower and entirely fair: every "Yes" in OUR column is
 * true of the package as it stands.
 *
 * It is worth checking because a comparison table is the most self-serving thing a project
 * publishes, and the one a reader is least able to verify. The two rows the page itself calls
 * load-bearing are the two that would be easiest to overstate: random access decides whether a
 * 24-hour study is usable in a browser tab, and EDF+D decides whether a discontinuous recording
 * produces a correct timeline or a plausible wrong one.
 *
 * Both are demonstrated rather than asserted — a partial read counted through a recording source,
 * and a gap that lands a record where the nominal grid would not.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('comparison.md') ?? '';
const MANIFEST = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string>; exports: Record<string, { types?: string }> };

/** Every row of the capabilities table, keyed by capability, holding only our cell. */
const OURS: ReadonlyMap<string, string> = (() => {
  const at = PAGE.indexOf('| Capability | edfcore |');
  if (at === -1) throw new Error('comparison.md no longer tabulates capabilities');
  const rows = new Map<string, string>();
  for (const line of PAGE.slice(at).split('\n')) {
    if (!line.startsWith('|')) break;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    rows.set(cells[0] ?? '', cells[1] ?? '');
  }
  rows.delete('Capability');
  rows.delete('---');
  return rows;
})();

const claim = (capability: string): string => {
  const cell = OURS.get(capability);
  if (cell === undefined) throw new Error(`no row for ${JSON.stringify(capability)}`);
  return cell;
};

describe('the table itself', () => {
  it('has the seven rows, and an edfcore cell for each', () => {
    expect(OURS.size).toBe(7);
    for (const [capability, cell] of OURS) expect(cell, capability).not.toBe('');
  });

  it('is checked only for our own column, on purpose', () => {
    // The sentence that makes the other columns somebody else's to verify.
    expect(PAGE.replace(/\s+/g, ' ')).toContain(
      '"Not established" means this survey did not verify it either way',
    );
  });
});

describe('the two rows the page calls load-bearing', () => {
  it('claims random access, and reads a slice rather than the file', async () => {
    expect(claim('Random access')).toBe('Yes');
    const bytes = buildEdf({
      recordCount: 400,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 64 }],
    });
    const spy = spySource(byteSource(bytes));
    const recording = await openEdf(spy);
    await readWindow(recording, { startSeconds: 300, durationSeconds: 5, signalIndices: [0] });

    const moved = spy.reads.reduce((total, read) => total + read.length, 0);
    // A small fraction of the file, and the read is nowhere near the front of it.
    expect(moved).toBeLessThan(bytes.byteLength / 10);
    expect(Math.max(...spy.reads.map((read) => read.offset))).toBeGreaterThan(bytes.byteLength / 2);
  });

  it('claims EDF+D, and puts a record where the nominal grid would not', async () => {
    expect(claim('EDF+D')).toBe('Yes');
    const recording = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'D',
          recordCount: 6,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [{ samplesPerRecord: 40 }],
          recordOnsetSeconds: (record) => (record <= 2 ? record : record + 10),
        }),
      ),
    );
    expect(recording.header.variant).toBe('EDF+D');
    expect(recording.header.continuity).toBe('discontinuous');
    // "A reader that treats an `EDF+D` file as contiguous does not fail; it reports every record
    //  after the first gap at the wrong time." Record 3 is at 13 s, not at 3 s.
    const index = await edfcore.buildRecordIndex(recording);
    const located = await index.locate(13.5);
    expect(located?.recordIndex).toBe(3);
    expect(located?.recordStartSeconds).toBe(13);
    expect(recording.timeline.spanSeconds).not.toBe(recording.timeline.coveredSeconds);
  });
});

describe('the remaining rows of our column', () => {
  it('claims TypeScript types, and every subpath declares one', () => {
    expect(claim('TypeScript types')).toBe('Yes');
    for (const [subpath, target] of Object.entries(MANIFEST.exports)) {
      if (subpath.endsWith('.json')) continue;
      expect(target.types, subpath).toMatch(/\.d\.ts$/);
    }
  });

  it('claims BDF, and reads a 24-bit sample', async () => {
    expect(claim('BDF / 24-bit')).toBe('Yes');
    const recording = await openEdf(
      byteSource(
        buildEdf({
          format: 'BDF',
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [
            {
              label: 'A1',
              samplesPerRecord: 4,
              digitalMinimum: -8_388_608,
              digitalMaximum: 8_388_607,
              sample: (_record, index) => [-8_388_608, -1, 1, 8_388_607][index] ?? 0,
            },
          ],
        }),
      ),
    );
    expect(recording.header.bytesPerSample).toBe(3);
    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 1,
      signalIndices: [0],
    });
    // The extremes only a 24-bit path can carry.
    expect([...(chunk?.signals[0]?.digital ?? [])]).toEqual([-8_388_608, -1, 1, 8_388_607]);
  });

  it('claims annotations, and returns an event', async () => {
    expect(claim('Annotations')).toBe('Yes');
    const recording = await openEdf(
      byteSource(
        minimalEdfPlus({
          recordCount: 3,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [
            {
              samplesPerRecord: 40,
              tals: (record) => (record === 1 ? [{ onset: 1.5, texts: ['Arousal'] }] : []),
            },
          ],
        }),
      ),
    );
    const { annotations } = await readAnnotations(recording, { start: 0, count: 3 });
    expect(annotations.map((entry) => entry.text)).toContain('Arousal');
  });

  it('claims typed errors, and every one carries a kind', () => {
    expect(claim('Typed errors')).toBe('Yes');
    const classes = Object.keys(edfcore).filter(
      (name) => name.startsWith('Edf') && name.endsWith('Error'),
    );
    expect(classes.length).toBeGreaterThan(4);
  });

  it('claims no runtime dependencies, and the manifest declares none', () => {
    expect(claim('Runtime dependencies')).toBe('None');
    expect(MANIFEST.dependencies).toBeUndefined();
  });
});
