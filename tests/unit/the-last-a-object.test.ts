/**
 * `a object`, in the last of this package's five describers still saying it.
 *
 * `describeSample` names what `decodeStatusWord` refused, and it built the phrase as
 * `a ${typeof sample}`. Five of the six things `typeof` can still return there take "a". The sixth
 * is `object` — and an object is exactly what this guard exists to catch: its own comment says `&`
 * "coerces rather than refuses", so a caller who reached for the samples and passed the signal, or
 * the typed array one field along, gets a well-formed Status word out of a wrong argument unless
 * something refuses it.
 *
 * 0.6.230 fixed the describer behind every read, and quoted `io/source.ts` for the reason: "an
 * article needs to know that `Uint8Array` is said 'yoo-int', which no rule about vowels gets right,
 * and getting it wrong is the kind of thing a reader notices instead of the message". Three others
 * — `io/bytes.ts`, `tal/ticks.ts`, `text/describe.ts` — already special-cased `object`. This was
 * the one left.
 *
 * The test reads the property out of the source rather than asserting the single case, so a sixth
 * describer cannot appear with the same slip.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeStatusWord } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('an object where a Status sample belongs', () => {
  it.each([
    ['an empty object', {}],
    ['an array', []],
    ['a Map', new Map()],
  ])('says "an object" rather than "a object", for %s', (_shape, given) => {
    const thrown = refusal(() => decodeStatusWord(given as never));
    expect(thrown.message).not.toContain('a object');
    expect(thrown.message).toContain('an object is not a 24-bit Status word');
  });

  it('is the mistake this guard exists for', async () => {
    const recording = await openEdf(byteSource(FILE));
    const chunks = await readWindow(recording, {
      signalIndices: [1],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const signal = chunks[0]?.signals[0];
    // The signal rather than one sample of it, and the typed array one field along.
    expect(refusal(() => decodeStatusWord(signal as never)).message).toContain('an object');
    expect(refusal(() => decodeStatusWord(signal?.digital as never)).message).toContain(
      'an object',
    );
  });

  it('keeps the rest of the sentence', () => {
    const thrown = refusal(() => decodeStatusWord({} as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('a whole number in -8388608..16777215');
    expect(thrown.message).toContain('Next:');
  });
});

describe('everything else this describer names', () => {
  it.each([
    ['null', null, 'null is not a 24-bit'],
    ['undefined', undefined, 'undefined is not a 24-bit'],
    ['a string', '5', 'a string is not a 24-bit'],
    ['a bigint', 5n, 'a bigint is not a 24-bit'],
    ['a boolean', true, 'a boolean is not a 24-bit'],
    ['NaN', Number.NaN, 'NaN is not a 24-bit'],
    ['a fraction', 1.5, '1.5 is not a 24-bit'],
    ['too wide', 0x1000000, '16777216 is not a 24-bit'],
  ])('is unchanged for %s', (_shape, given, expected) => {
    expect(refusal(() => decodeStatusWord(given as never)).message).toContain(expected);
  });

  it('still decodes both spellings of a real word', () => {
    expect(decodeStatusWord(0).trigger).toBe(0);
    expect(decodeStatusWord(-1).trigger).toBe(0xffff);
    expect(decodeStatusWord(0xffffff).batteryLow).toBe(true);
  });
});

describe('the property, across every describer in src/', () => {
  it('leaves none of them building the article from typeof object', () => {
    const offenders: string[] = [];
    const walk = (dir: URL, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const source = readFileSync(new URL(entry.name, dir), 'utf8');
        // Comments quote the old phrase on purpose; only code counts.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '');
        for (const line of code.split('\n')) {
          if (!line.includes('`a ${typeof')) continue;
          // Fine only when `object` was answered before reaching this line.
          if (!code.includes("=== 'object'")) offenders.push(`${prefix}${entry.name}`);
        }
      }
    };
    walk(new URL('../../src/', import.meta.url), '');
    expect(offenders).toEqual([]);
  });
});
