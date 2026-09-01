/**
 * What happens when the callback YOU passed in throws.
 *
 * edfcore takes four things from a caller that it then calls: a `ByteSource.read`, an
 * `onProgress` on the two traversals, and a predicate on the two `match`/`filter` helpers. Three
 * of the four are documented for what they RETURN and none of the four for what happens when they
 * throw, which is not an exotic case: a progress callback writes to a DOM node that has been
 * removed, a label predicate does `label.toLowerCase()` on a file whose fifth signal has no label,
 * a source rejects because the tab went offline.
 *
 * Two answers matter and they pull in opposite directions.
 *
 * The error must arrive UNCHANGED — the same object, not wrapped in an `EdfError`, not turned into
 * a diagnostic, not swallowed. Wrapping it would make the caller's own bug look like a problem
 * with the file, which is the confusion this package works hardest to avoid, and `isEdfError` must
 * say false for it because it is not edfcore's error.
 *
 * And the recording must SURVIVE it. Every one of these calls is made partway through something
 * with state — a memo being filled, a diagnostic list being built, an index being probed — and a
 * throw from the caller's code unwinds through all of it. If that leaves the recording poisoned,
 * a caller whose progress bar threw once cannot read the file again, and nothing tells them why.
 *
 * `source-contract.test.ts` covers the source: "an I/O rejection propagates and is never swallowed
 * into a diagnostic". The other three had nothing.
 */

import { describe, expect, it } from 'vitest';
import { countAnnotationsByText, filterAnnotationsByText } from '../../src/annotations-query.js';
import { isEdfError } from '../../src/errors.js';
import { matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** Six records with real timekeeping, so a scan has several chunks to report through. */
const FILE = buildEdf({
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (record) => [{ onset: record, texts: ['Sleep stage W'] }] },
  ],
});

/** The caller's error, distinguishable from anything the library could have made. */
class CallerBug extends Error {
  readonly mine = true;
  constructor() {
    super('the callback threw');
    this.name = 'CallerBug';
  }
}

const explode = (): never => {
  throw new CallerBug();
};

async function thrownBy(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('the call did not throw, so there is nothing to check');
}

async function opened() {
  const recording = await openEdf(byteSource(FILE));
  return recording;
}

describe('the error arrives as the caller threw it', () => {
  it('from onProgress on buildRecordIndex', async () => {
    const error = await thrownBy(async () =>
      buildRecordIndex(await opened(), { onProgress: explode }),
    );
    expect(error).toBeInstanceOf(CallerBug);
    expect(isEdfError(error)).toBe(false);
  });

  it('from onProgress on validateRecording', async () => {
    const error = await thrownBy(async () =>
      validateRecording(await opened(), { scanSamples: true, onProgress: explode }),
    );
    expect(error).toBeInstanceOf(CallerBug);
    expect(isEdfError(error)).toBe(false);
  });

  it('from a signal-matching predicate', async () => {
    const { header } = await opened();
    const error = await thrownBy(() => matchSignals(header, explode));
    expect(error).toBeInstanceOf(CallerBug);
    expect(isEdfError(error)).toBe(false);
  });

  it('from an annotation-matching predicate', async () => {
    const recording = await opened();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 6 });
    expect(annotations.length).toBeGreaterThan(0);
    const error = await thrownBy(() => filterAnnotationsByText(annotations, explode));
    expect(error).toBeInstanceOf(CallerBug);
    expect(isEdfError(error)).toBe(false);
  });

  it('and never as a diagnostic, which would blame the file for the caller', async () => {
    // The one outcome that would be actively misleading: a report that opens fine and carries a
    // diagnostic about a recording whose only problem was in the calling program.
    const recording = await opened();
    const before = await validateRecording(recording, { scanSamples: true });
    await thrownBy(() => validateRecording(recording, { scanSamples: true, onProgress: explode }));
    const after = await validateRecording(recording, { scanSamples: true });
    expect(after.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      before.diagnostics.map((diagnostic) => diagnostic.code),
    );
  });
});

describe('and the recording still works afterwards', () => {
  it('scans to the same index once the callback stops throwing', async () => {
    const recording = await opened();
    // Throw on the FIRST report, so the traversal unwinds with its memo half filled.
    let calls = 0;
    await thrownBy(() =>
      buildRecordIndex(recording, {
        onProgress: () => {
          calls += 1;
          throw new CallerBug();
        },
      }),
    );
    expect(calls).toBe(1);

    const recovered = await buildRecordIndex(recording);
    const fresh = await buildRecordIndex(await opened());
    expect(recovered.coverage).toBe(fresh.coverage);
    expect(recovered.segments).toEqual(fresh.segments);
    expect(recovered.gaps).toEqual(fresh.gaps);
    expect(await recovered.onsetTicks(5)).toBe(await fresh.onsetTicks(5));
  });

  it('validates to the same verdict once the callback stops throwing', async () => {
    const recording = await opened();
    await thrownBy(() => validateRecording(recording, { scanSamples: true, onProgress: explode }));

    const recovered = await validateRecording(recording, { scanSamples: true });
    const fresh = await validateRecording(await opened(), { scanSamples: true });
    expect(recovered.ok).toBe(fresh.ok);
    expect(recovered.recordsScanned).toBe(fresh.recordsScanned);
    expect(recovered.diagnostics.map((d) => d.code)).toEqual(fresh.diagnostics.map((d) => d.code));
  });

  it('leaves the annotations it was given exactly as they were', async () => {
    const recording = await opened();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 6 });
    const before = countAnnotationsByText(annotations);

    await thrownBy(() => filterAnnotationsByText(annotations, explode));

    expect(countAnnotationsByText(annotations)).toEqual(before);
    // And a predicate that works still works on the same array.
    expect(filterAnnotationsByText(annotations, () => true)).toHaveLength(annotations.length);
  });

  it('throws again the next time, rather than remembering that it failed', async () => {
    // The failure mode a memoised promise produces: one bad callback and the operation is
    // permanently broken. The second call must reach the callback again, not a cached rejection.
    const recording = await opened();
    let calls = 0;
    const counting = (): never => {
      calls += 1;
      throw new CallerBug();
    };

    await thrownBy(() => buildRecordIndex(recording, { onProgress: counting }));
    await thrownBy(() => buildRecordIndex(recording, { onProgress: counting }));
    expect(calls).toBe(2);
  });
});
