/**
 * The two decoders, measuring a record buffer against a header that is not one.
 *
 * Both answer a size mismatch by stating the file's own geometry — "1 records of 716 bytes each are
 * exactly 716" — which is the right message and the wrong thing to compute from an argument nobody
 * checked. The recording where the header belongs made `decodeAnnotations` say "of this file is
 * exactly NaN bytes (1 x undefined)", and an `ArrayBuffer` where the bytes belong made
 * `decodeDigital` say "recordBytes is undefined bytes — NaN whole records".
 *
 * Both are sentences about the FILE with arithmetic nonsense in them, produced by a caller's wrong
 * argument — which is the one confusion `byteSource` says this package works hardest to avoid
 * (fixed in 0.6.122).
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfHeader } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (r) => (r === 1 ? [{ onset: 1, texts: ['W'] }] : []) },
  ],
});

const RECORDS = { start: 0, count: 1 } as const;

async function parts() {
  const recording = await openEdf(byteSource(BYTES));
  const recordBytes = await readRecordBytes(recording.source, recording.header, RECORDS);
  return { recording, header: recording.header, recordBytes };
}

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

const DECODERS: ReadonlyArray<
  readonly [string, (header: EdfHeader, bytes: Uint8Array) => unknown]
> = [
  ['decodeDigital', (header, bytes) => decodeDigital(header, bytes, RECORDS, 0)],
  ['decodeAnnotations', (header, bytes) => decodeAnnotations(header, bytes, RECORDS)],
];

describe.each(DECODERS)('%s', (name, call) => {
  it('names the recording rather than computing a geometry from it', async () => {
    const { recording, recordBytes } = await parts();
    const message = refusal(() => call(loosely<EdfHeader>(recording), recordBytes));
    expect(message).toContain(`${name}(): that is not a header — it has no recordByteLength`);
    expect(message).toContain('Next: pass recording.header');
  });

  it('says nothing about the file being NaN bytes', async () => {
    const { recording, recordBytes } = await parts();
    const message = refusal(() => call(loosely<EdfHeader>(recording), recordBytes));
    expect(message).not.toContain('NaN');
    expect(message).not.toContain('undefined bytes');
  });

  it('names an ArrayBuffer as one, and where the bytes come from', async () => {
    const { header, recordBytes } = await parts();
    const message = refusal(() => call(header, loosely<Uint8Array>(recordBytes.slice().buffer)));
    expect(message).toContain(`${name}(): the record bytes are ArrayBuffer, not a Uint8Array`);
    expect(message).toContain('readRecordBytes(source, header, records)');
  });

  it("still reports a real size mismatch in the file's own numbers", async () => {
    const { header, recordBytes } = await parts();
    const message = refusal(() => call(header, recordBytes.subarray(0, 10)));
    expect(message).toMatch(/\d+/);
    expect(message).not.toContain('NaN');
  });

  it('still decodes the right pair', async () => {
    const { header, recordBytes } = await parts();
    expect(() => call(header, recordBytes)).not.toThrow();
  });
});
