/**
 * The `bigint` ticks decision, executed.
 *
 * `design-decisions.md` defends it with a failure that is specific and hard to notice: "Float
 * equality on event times is how ERP alignment breaks without anyone noticing. Two onsets that are
 * the same instant on disk compare unequal after a round trip through a binary fraction. An
 * averaging window then lands one sample off for a subset of trials."
 *
 * That is a claim about arithmetic, so it can be shown rather than asserted — and it is worth
 * showing, because the cost paragraph underneath ("`bigint` does not mix with `number`, does not
 * survive `JSON.stringify`") is a standing invitation to convert to seconds and be done with it.
 * A test that demonstrates the failure is a better argument against that than a sentence.
 *
 * The path itself is checked from the source: `tal/ticks.ts` says `parseFloat`, `Number(text)` and
 * float arithmetic appear nowhere on it, and nothing made that true. It is one careless
 * `Number(digits)` away from being false while every existing test still passes, because the two
 * agree on almost every value.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { codeOnly } from '../support/code-only.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('design-decisions.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');
const TICKS_SOURCE = readFileSync(new URL('../../src/tal/ticks.ts', import.meta.url), 'utf8');

/** Every annotation of a file carrying `onsets`, in order. */
async function annotationsAt(onsets: readonly (number | string)[]) {
  const bytes = minimalEdfPlus({
    recordCount: onsets.length + 1,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 60,
        tals: (record) =>
          record === 0 ? onsets.map((onset, at) => ({ onset, texts: [`E${at}`] })) : [],
      },
    ],
  });
  const recording = await openEdf(byteSource(bytes));
  const { annotations } = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  return annotations.filter((entry) => entry.text !== '');
}

describe('the constant and the worked pair', () => {
  it('publishes the tick rate the page publishes', () => {
    // "`TICKS_PER_SECOND` is `10000000n`."
    const printed = /`TICKS_PER_SECOND` is `(\d+)n`/.exec(FLAT);
    expect(printed).not.toBeNull();
    expect(TICKS_PER_SECOND).toBe(BigInt(printed?.[1] ?? '0'));
  });

  it('produces both numbers the page prints for one annotation', async () => {
    // `annotation.onsetTicks;  // 132500000n — exact`
    // `annotation.onsetSecondsFromHeaderStart;  // 13.25 — convenient, and lossy in general`
    const ticks = /onsetTicks;\s*\/\/ (\d+)n/.exec(PAGE);
    const seconds = /onsetSecondsFromHeaderStart;\s*\/\/ ([\d.]+)/.exec(PAGE);
    expect(ticks).not.toBeNull();
    expect(seconds).not.toBeNull();

    const [event] = await annotationsAt([Number(seconds?.[1])]);
    expect(event?.onsetTicks).toBe(BigInt(ticks?.[1] ?? '0'));
    expect(event?.onsetSecondsFromHeaderStart).toBe(Number(seconds?.[1]));
  });
});

describe('the failure the decision exists to prevent', () => {
  it('has two onsets that are one instant on disk and two floats after conversion', async () => {
    // Written verbatim so the file holds these exact digit strings. `0.1 + 0.2` is the standard
    // witness; here it is two ways of writing the same instant that a float cannot keep apart
    // from its neighbour.
    // Looked up by text: the result is sorted by `onsetTicks`, not by the order written.
    const events = await annotationsAt(['0.3', '0.1']);
    const three = events.find((entry) => entry.text === 'E0');
    const one = events.find((entry) => entry.text === 'E1');
    expect(three?.onsetTicks).toBe(3_000_000n);
    expect(one?.onsetTicks).toBe(1_000_000n);

    // Exact in ticks: three tenths is three times one tenth, to the tick.
    expect((one?.onsetTicks ?? 0n) * 3n).toBe(three?.onsetTicks);
    // And not in seconds, which is the whole decision in one line.
    expect((one?.onsetSecondsFromHeaderStart ?? 0) * 3).not.toBe(
      three?.onsetSecondsFromHeaderStart,
    );
  });

  it('keeps a decimal no float can hold, to the tick', async () => {
    // Seven decimal places is exactly one tick, and the format allows them.
    const [event] = await annotationsAt(['1.2345678']);
    expect(event?.onsetTicks).toBe(12_345_678n);
    // The float of that value is not the value.
    expect(Number(event?.onsetTicks) / Number(TICKS_PER_SECOND)).toBe(
      event?.onsetSecondsFromHeaderStart,
    );
    expect(String(event?.onsetSecondsFromHeaderStart)).toBe('1.2345678');
  });

  it('keeps the digit string itself, so nothing is lost even to the tick conversion', async () => {
    // "the original digit string is kept on `onsetRaw`"
    expect(FLAT).toContain('the original digit string is kept on `onsetRaw`');
    const [event] = await annotationsAt(['1.2345678']);
    expect(event?.onsetRaw).toContain('1.2345678');
  });
});

describe('the path the page says has no float on it', () => {
  it('says so in its own docblock', () => {
    expect(TICKS_SOURCE).toContain('`parseFloat`, `Number(text)` and float arithmetic appear');
  });

  it('has none, on the code rather than the comment', () => {
    // Comments stripped first: the sentence above quotes the very calls being looked for, so an
    // unstripped scan would report the explanation as the violation.
    const code = codeOnly(TICKS_SOURCE);
    expect(code).not.toContain('parseFloat');
    expect(code).not.toContain('parseInt');
    // `Number(...)` on a string is the careless one. Converting a bigint for display is not.
    expect(code).not.toMatch(/Number\((?!.*[Tt]icks|.*PER_SECOND|.*magnitude)[a-z]/);
  });
});
