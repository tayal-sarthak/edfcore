/**
 * The `grid` prefix is a rule, and this is the rule.
 *
 * `migrating-to-0-3.md` explains why three functions were renamed in a minor release: they measure
 * the signal's own sample grid, `n × recordDuration / samplesPerRecord`, which on a contiguous
 * recording is also elapsed recording time — "which is exactly why the difference was easy to
 * miss". The page then counts the cost: seven separate fixes for one defect, each found because
 * two functions disagreed rather than because one looked wrong.
 *
 * Its conclusion is a naming rule. "The `grid` prefix is what stops the seventh: you cannot call
 * `gridSampleStartSeconds` and believe you asked for elapsed recording time." A rule that a rename
 * established and nothing enforces is a rule that lasts until the next function is added, and the
 * next function is the one that would ship the eighth.
 *
 * So it is enforced from both sides: every export of the grid module carries the prefix, and no
 * export of the recording-aware module carries it. And the reason for the split is asserted rather
 * than described — on a file with a hole, the two answers for the same sample differ, which is the
 * whole content of the page.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { gridSampleStartSeconds } from '../../src/sample-grid.js';
import { sampleStartSecondsOf } from '../../src/sample-locate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('migrating-to-0-3.md') ?? '';

const exportsOf = (module: string): readonly string[] =>
  [
    ...readFileSync(new URL(`../../src/${module}`, import.meta.url), 'utf8').matchAll(
      /^export function (\w+)/gm,
    ),
  ].map((match) => match[1] as string);

describe('the rule the page states', () => {
  it('is stated there, so this file is not enforcing something nobody claimed', () => {
    expect(PAGE.replace(/\s+/g, ' ')).toContain(
      'you cannot call `gridSampleStartSeconds` and believe you asked for elapsed recording time',
    );
  });

  it('holds for every export of the grid module', () => {
    const named = exportsOf('sample-grid.ts');
    expect(named.length).toBeGreaterThan(2);
    expect(named.filter((name) => !name.startsWith('grid'))).toEqual([]);
  });

  it('holds in the other direction for the recording-aware module', () => {
    // These take a RECORDING and answer in elapsed recording time. A `grid` name here would be a
    // lie in the opposite direction, and the prefix is only a signal if it is exclusive.
    const named = exportsOf('sample-locate.ts');
    expect(named.length).toBeGreaterThan(2);
    expect(named.filter((name) => name.startsWith('grid'))).toEqual([]);
  });
});

describe('the reason for the split', () => {
  it('is a real disagreement on a file with a hole in it', async () => {
    // The page's own example: a seven-second hole after record 2, and the twelfth sample sitting
    // at 3 s on the grid while record 3 truly begins at 10 s.
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordOnsetSeconds: (record: number) => (record < 3 ? record : record + 7),
    });
    const opened = await openEdf(byteSource(bytes));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    const signal = getSignal(recording.header, 'Fp1');

    const onTheGrid = gridSampleStartSeconds(signal, 12, recording.header.recordDurationTicks);
    const inTheRecording = sampleStartSecondsOf(recording, signal.index, 12);

    expect(onTheGrid).toBe(3);
    expect(inTheRecording).toBe(10);
    // "Both numbers are correct about different things. The name said neither."
    expect(onTheGrid).not.toBe(inTheRecording);
  });

  it('collapses on a contiguous file, which is why it was easy to miss', async () => {
    // The same two calls, same sample, same answer. A test that only ever used a contiguous file
    // would find the two functions interchangeable — which is how the seven fixes happened.
    const bytes = buildEdf({
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    const recording = await openEdf(byteSource(bytes));
    const signal = getSignal(recording.header, 'Fp1');

    expect(gridSampleStartSeconds(signal, 12, recording.header.recordDurationTicks)).toBe(
      sampleStartSecondsOf(recording, signal.index, 12),
    );
  });
});
