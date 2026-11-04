/**
 * A list of labels handed to `filterAnnotationsByText`.
 *
 * Narrowing a hypnogram to its stages means matching several labels at once, and the list of them
 * is what a caller holds. It was told to pass "the label as a string" — one label, which is the one
 * thing a caller with a list does not want — rather than the predicate that takes all of them.
 */

import { expect, it } from 'vitest';
import { filterAnnotationsByText } from '../../src/annotations-query.js';

it('filterAnnotationsByText() points a list of labels at a predicate', () => {
  expect(() => filterAnnotationsByText([], ['Sleep stage W', 'Sleep stage 1'] as never)).toThrow(
    'Next: for a list of labels, pass (text) => labels.includes(text).',
  );
  expect(() => filterAnnotationsByText([], {} as never)).toThrow('pass the label as a string');
});
