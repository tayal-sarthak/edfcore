/**
 * A non-finite time is refused by the name the caller gave it.
 *
 * `secondsToTicks` is the one place a caller's seconds become ticks, and it is reached from fifteen
 * call sites in eight modules. Its refusal ended "Next: check the window bound you passed in".
 *
 * Most of those callers guard first, with a message naming their own parameter — `sampleAt`,
 * `segmentAt`, `gapAt`, `readEnvelopeAtResolution` and the sample grid all do, which is the shape
 * this now matches rather than departs from. Four entry points fall through to the shared message,
 * and two of them take an INSTANT rather than a window: `annotationsAt`, which a viewer calls on
 * every mouse move, and `index.locate`. Both sent the caller to check a bound they had not passed.
 *
 * `options.ts` documents the pair from the other side, about the same class of mistake: "One bad
 * option, two different wrong diagnoses. Resolving it in one place means the message names the
 * argument that is actually wrong" (0.3.21). `missing-signal-indices.test.ts` records the other
 * resolution — `resolveSignals` carries NO caller prefix "because a hard-coded name would be wrong
 * for all but one of them" — which is what you do when the callers cannot say which argument it
 * was. These can, so they do.
 *
 * The call sites are enumerated from `src/`, so a sixteenth that forgets to name its argument fails
 * here rather than inheriting somebody else's noun.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { annotationsAt, filterAnnotationsByTime } from '../../src/annotations-query.js';
import { readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import type { EdfAnnotation, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SRC = new URL('../../src/', import.meta.url);

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const open = (): Promise<EdfRecording> => openEdf(byteSource(BYTES));

/** Every `secondsToTicks(` call under `src/`, with the text of its arguments. */
function callSites(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = readFileSync(new URL(entry.name, directory), 'utf8');
      for (const match of source.matchAll(/secondsToTicks\(([^)]*)\)/g)) {
        if (match[1] === 'seconds: number, name: string') continue;
        found.push(`${prefix}${entry.name}: ${match[1] ?? ''}`);
      }
    }
  };
  walk(SRC, '');
  return found;
}

async function refusal(run: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as Error).message);
  }
  throw new Error('the call was not refused');
}

describe('every call site', () => {
  it('was found, so a passing run is not a vacuous one', () => {
    expect(callSites().length).toBeGreaterThan(10);
  });

  it('names the argument it is converting', () => {
    for (const site of callSites()) {
      expect({ site, named: /,\s*'[\w.]+'\s*$/.test(site) }).toEqual({ site, named: true });
    }
  });
});

describe('the name that reaches the caller', () => {
  it('is the window bound, where there is one', async () => {
    const recording = await open();
    const message = await refusal(() =>
      readWindow(recording, {
        startSeconds: Number.NaN,
        durationSeconds: 1,
        signalIndices: [0],
      }),
    );
    expect(message).toContain('startSeconds must be a finite number of seconds, but was NaN');
  });

  it('is the instant, for the two entry points that take one', async () => {
    // The sites that made this worth changing: nothing about either call is a window.
    const recording = await open();
    const index = await buildRecordIndex(recording);

    for (const run of [
      () => annotationsAt([] as readonly EdfAnnotation[], Number.NaN),
      () => index.locate(Number.NaN),
    ]) {
      const message = await refusal(run);
      expect(message).toContain('seconds must be a finite number of seconds');
      expect(message).not.toContain('window');
    }
  });

  it('is left alone where the caller already guarded with its own name', async () => {
    // Most callers refuse before reaching the shared helper, naming their own parameter. That is
    // the shape this change matches rather than departs from, and it is checked so a later
    // simplification does not remove those guards in the name of having one message.
    const recording = await open();
    expect(await refusal(() => sampleAt(recording, 0, Number.NaN))).toContain(
      'sampleAt(): seconds must be a finite number',
    );
    expect(
      await refusal(() =>
        readEnvelopeAtResolution(recording, {
          secondsPerBucket: Number.NaN,
          signalIndices: [0],
        } as never),
      ),
    ).toContain('readEnvelopeAtResolution(): secondsPerBucket must be a positive finite number');
  });

  it('is the window field a query was given, spelled as the caller spells it', async () => {
    const message = await refusal(() =>
      filterAnnotationsByTime([] as readonly EdfAnnotation[], {
        startSeconds: Number.NaN,
        durationSeconds: 1,
      }),
    );
    expect(message).toContain('window.startSeconds must be a finite number of seconds');
  });

  it('differs between callers, which is the whole point', async () => {
    const recording = await open();
    const names = new Set<string>();
    for (const run of [
      () =>
        readWindow(recording, { startSeconds: Number.NaN, durationSeconds: 1, signalIndices: [0] }),
      () =>
        readWindow(recording, { startSeconds: 0, durationSeconds: Number.NaN, signalIndices: [0] }),
      () => annotationsAt([] as readonly EdfAnnotation[], Number.NaN),
    ]) {
      const message = await refusal(run);
      names.add(message.slice(0, message.indexOf(' must be')));
    }
    expect(names).toEqual(new Set(['startSeconds', 'durationSeconds', 'seconds']));
  });
});

describe('the advice', () => {
  it('names where a non-finite number comes from, rather than a bound to check', async () => {
    const recording = await open();
    const message = await refusal(() =>
      readWindow(recording, {
        startSeconds: Number.POSITIVE_INFINITY,
        durationSeconds: 1,
        signalIndices: [0],
      }),
    );
    expect(message).toContain('Next: check the expression that produced it');
    expect(message).toContain('a division by zero yields Infinity');
    expect(message).not.toContain('check the window bound you passed in');
  });
});
