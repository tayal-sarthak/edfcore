/**
 * A recording passed to the four annotation queries.
 *
 * They were told to pass the `annotations` field of the readAnnotations() result, "which is a
 * result object rather than the list itself" — a sentence about an object the caller does not
 * have. A recording has not been read yet, so the step it is missing is the read.
 */

import { describe, expect, it } from 'vitest';
import {
  annotationsAt,
  byteSource,
  countAnnotationsByText,
  filterAnnotationsByText,
  filterAnnotationsByTime,
  openEdf,
} from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

describe('a recording passed where its annotations belong', () => {
  it.each([
    ['annotationsAt', (given: never) => annotationsAt(given, 0)],
    ['countAnnotationsByText', (given: never) => countAnnotationsByText(given)],
    ['filterAnnotationsByText', (given: never) => filterAnnotationsByText(given, 'x')],
    [
      'filterAnnotationsByTime',
      (given: never) => filterAnnotationsByTime(given, { startSeconds: 0, durationSeconds: 1 }),
    ],
  ])('%s() says it has not been read yet', async (call, run) => {
    const recording = await openEdf(byteSource(minimalEdf()));
    expect(() => run(recording as never)).toThrow(
      `${call}(): the annotations are a recording, which holds the file rather than its events`,
    );
    expect(() => run(recording as never)).not.toThrow('result object');
  });

  it('keeps the result-object advice for a result object', () => {
    const result = { annotations: [], recordOnsetTicks: [], diagnostics: [] };
    expect(() => annotationsAt(result as never, 0)).toThrow('a result object rather than the list');
  });
});
