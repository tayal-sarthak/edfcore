/**
 * A forgotten `await`, named as one.
 *
 * 0.6.89 made this argument for the recording and coined the phrase: a forgotten `await` "passes the
 * pending Promise `openEdf` returns", and a message that names an internal field instead says
 * "nothing about the one keyword that fixes it". `assertRecording` has said "a pending Promise" ever
 * since — and it was the only guard that did.
 *
 * Five async calls in this package resolve to values other guards take. `readHeader` resolves to a
 * header, `buildRecordIndex` to an index, `readWindow` to the chunk array, `validateRecording` to a
 * report, `readAnnotations` to a result. So each of these is one keyword short:
 *
 *     formatHeader(readHeader(source))
 *     mergeChunks(readWindow(recording, selection))
 *     contiguityOf(buildRecordIndex(recording))
 *
 * and every one was told it had passed "an object" — which is true of the thing they meant to pass
 * too, so the sentence gave a reader nothing to act on.
 *
 * Named in `describeValue` rather than at each guard: that module's whole subject is a value "said in
 * a way that cannot read as an accepted one", and about forty messages read their subject out of it.
 * It is a property read, never a call — nothing awaits, settles or subscribes to anything.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../../src/chunks.js';
import { toPhysical } from '../../../src/decode/physical.js';
import { formatDiagnostics } from '../../../src/diagnostics/format.js';
import { summarizeDiagnostics } from '../../../src/diagnostics/summary.js';
import { envelopeOfSamples } from '../../../src/envelope.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readHeader } from '../../../src/io/read.js';
import { buildRecordIndex } from '../../../src/record-index.js';
import { openEdf, readAnnotations, readWindow } from '../../../src/recording.js';
import { describeValue } from '../../../src/text/describe.js';
import { trimToWindow } from '../../../src/time/window.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

describe('describeValue', () => {
  it('names a pending Promise, and every other value as before', () => {
    expect(describeValue(Promise.resolve(1))).toBe('a pending Promise');
    // biome-ignore lint/suspicious/noThenProperty: a thenable is exactly what is under test.
    expect(describeValue({ then: () => {} })).toBe('a pending Promise');
    expect(describeValue({})).toBe('an object');
    expect(describeValue([])).toBe('an object');
    // biome-ignore lint/suspicious/noThenProperty: a `then` that is not callable is not a thenable.
    expect(describeValue({ then: 5 })).toBe('an object');
    expect(describeValue(new Uint8Array(1))).toBe('Uint8Array');
    expect(describeValue('x')).toBe('the string "x"');
    expect(describeValue(5)).toBe('5');
    expect(describeValue(5n)).toBe('the BigInt 5n');
    expect(describeValue(null)).toBe('null');
    expect(describeValue(undefined)).toBe('undefined');
  });

  it('reads the promise without settling or subscribing to it', async () => {
    let touched = false;
    const spy = {
      // biome-ignore lint/suspicious/noThenProperty: the getter is how the read is observed.
      get then() {
        touched = true;
        return () => {};
      },
    };
    expect(describeValue(spy)).toBe('a pending Promise');
    expect(touched).toBe(true);
    // A rejection nobody handles would surface as an unhandled rejection if this subscribed.
    const rejected = Promise.reject(new Error('never observed'));
    expect(describeValue(rejected)).toBe('a pending Promise');
    await rejected.catch(() => undefined);
  });
});

describe('the calls that are one keyword short', () => {
  it('names the await for a chunk array from readWindow', async () => {
    const recording = await openEdf(byteSource(FILE));
    const pending = readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 3,
    });
    expect(() => mergeChunks(pending as never)).toThrow(/a pending Promise/);
    await pending;
  });

  it('names the await for diagnostics that were never resolved', async () => {
    const recording = await openEdf(byteSource(FILE));
    const pending = readAnnotations(recording, { start: 0, count: 6 });
    expect(() => formatDiagnostics(pending as never)).toThrow(/a pending Promise/);
    // Not `summarizeDiagnostics`: that module "imports one type module and nothing else", which is
    // the property that lets any layer summarise, so it cannot reach `describeValue` and says only
    // that the argument is not an array. Recorded here rather than worked around.
    expect(() => summarizeDiagnostics(pending as never)).toThrow(/not an array/);
    await pending;
  });

  it('names the await for a header from readHeader, where it reaches a message that uses it', async () => {
    const pending = readHeader(byteSource(FILE));
    expect(() => toPhysical(pending as never, [1, 2])).toThrow(/a pending Promise/);
    await pending;
  });

  it('names the await for the samples, and for a chunk signal', async () => {
    const recording = await openEdf(byteSource(FILE));
    const header = recording.header;
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 3,
    });
    const pending = Promise.resolve(chunks[0]?.signals[0]);
    expect(() => toPhysical(header.signals[0] as never, pending as never)).toThrow(
      /a pending Promise/,
    );
    expect(() => envelopeOfSamples(pending as never, 4)).toThrow(/a pending Promise/);
    expect(() => trimToWindow(header, pending as never, 0, 1)).toThrow(/a pending Promise/);
    await pending;
  });

  it('leaves the 0.6.89 refusal for the recording saying its own thing', async () => {
    // Still fixed text rather than anything read out of `describeValue`, which is what this checks.
    // The text changed in 0.6.232: `openEdf(source)` is async, so a pending Promise is what it
    // returns, and saying it "is not the object openEdf() returns" was the one thing that could not
    // be true of one.
    const pending = openEdf(byteSource(FILE));
    await expect(buildRecordIndex(pending as never)).rejects.toThrow(
      /the recording is a pending Promise — openEdf\(source\) is async/,
    );
    await pending;
  });
});
