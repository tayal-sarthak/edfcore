/**
 * The read options handed to `index.onsetTicks` and `index.locate`, which a spread erased.
 *
 * Both take `options?: ReadOptions` in the published `EdfRecordIndex` type, and both read: the
 * docblock on `onsetTicks` says one whole record per call, and `locate` issues O(log recordCount) of
 * them — "which is exactly the number a caller planning HTTP range requests is reading this line to
 * compute". Cancelling and bounding them is the point of the argument.
 *
 * It never arrived. `buildTimeline` composes each probe's options as `{ ...readOptions, strict }`,
 * and spreading an `AbortSignal` yields `{ strict }` — the `signal` has no enumerable own property
 * to copy. A bare number yields the same. So by the time `assertReadOptions` sees anything it is a
 * perfectly well-formed options object, and the mistake is not merely deferred the way 0.6.169 and
 * 0.6.177 found it deferred: it is undetectable downstream, on every file, for good.
 *
 * `buildTimeline` already makes this argument about the parse half — "a bare value here would build
 * `{ strict: false }` and reach the sink as a perfectly good object" — which is why
 * `assertParseOptions` sits at the top of it. The read half launders identically and had no guard.
 *
 * Memoisation makes it worse rather than better. Record 0 and the last record are probed by
 * `openEdf`, so `onsetTicks(0, controller.signal)` returned from the memo without issuing a read at
 * all, and a `locate` over a short file did the same — the uncancellable call and the free one being
 * the same call.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 8;

/** Timekeeping present: every onset but the two memoised ones costs a real read. */
const TIMEKEPT = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** A plain EDF, where onsets are nominal and no read happens — the same call must still refuse. */
const NOMINAL = buildEdf({
  format: 'EDF',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ['an EDF+ file, where the onset is read', TIMEKEPT],
  ['a plain EDF, where it is derived', NOMINAL],
];

const BARE: ReadonlyArray<readonly [string, unknown, RegExp]> = [
  ['an AbortSignal', new AbortController().signal, /signal is a field on/],
  ['a byte count', 64 * 1024 * 1024, /maxMaterializeBytes and signal are fields on one/],
  ['a boolean', true, /maxMaterializeBytes and signal are fields on one/],
];

const opened = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe.each(FILES)('%s', (_name, bytes) => {
  describe.each(BARE)('given %s where the read options belong', (_shape, options, expected) => {
    it('refuses onsetTicks on a record that has to be read', async () => {
      const recording = await opened(bytes);
      await expect(recording.index.onsetTicks(3, options as never)).rejects.toThrow(expected);
    });

    it('refuses onsetTicks on a record openEdf already memoised', async () => {
      const recording = await opened(bytes);
      // Record 0 is in hand before the call, so this one never issued a read to be refused by.
      await expect(recording.index.onsetTicks(0, options as never)).rejects.toThrow(expected);
      await expect(recording.index.onsetTicks(RECORDS - 1, options as never)).rejects.toThrow(
        expected,
      );
    });

    it('refuses locate', async () => {
      const recording = await opened(bytes);
      await expect(recording.index.locate(3, options as never)).rejects.toThrow(expected);
    });

    it('refuses locate for a time outside the recording, which answers undefined', async () => {
      const recording = await opened(bytes);
      await expect(recording.index.locate(-5, options as never)).rejects.toThrow(expected);
      await expect(recording.index.locate(1000, options as never)).rejects.toThrow(expected);
    });
  });

  it('still answers with no options at all', async () => {
    const recording = await opened(bytes);
    await expect(recording.index.onsetTicks(3)).resolves.toBe(30000000n);
    await expect(recording.index.locate(3)).resolves.toBeDefined();
  });

  it('still honours an options object, and the bad index still comes first', async () => {
    const recording = await opened(bytes);
    const options = { maxMaterializeBytes: 8 * 1024 * 1024 };
    await expect(recording.index.onsetTicks(2, options)).resolves.toBe(20000000n);
    await expect(recording.index.locate(2, options)).resolves.toBeDefined();
    // `assertRecordIndex` runs ahead of the options check, as it always did.
    await expect(recording.index.onsetTicks(99, 64 as never)).rejects.toThrow(
      /is not one of the 8 data records/,
    );
  });
});
