/**
 * What a structured clone keeps of an edfcore error, run rather than recited.
 *
 * `api-errors.md` explains why `edfErrorKind` exists and why it does not survive `postMessage`,
 * and the explanation said the algorithm "keeps an Error's `name`, `message`, `stack` and `cause`
 * and drops every own property". Three of those four are right. `name` is kept only for the seven
 * built-in error types; everything else is normalised to `'Error'`, so every one of edfcore's
 * seven classes arrives named `Error` (fixed in 0.6.61).
 *
 * It is the one clause on that page a reader would act on. The section is about what to do when
 * the discriminator is gone, the page says two paragraphs later that `error.name` is the concrete
 * class's name — `'EdfFormatError'` rather than `'Error'` — and the obvious fallback in a worker
 * is therefore to branch on `name`. On the receiving side of a `postMessage` that branch never
 * matches, for any error this package throws.
 *
 * `structuredClone` is the same algorithm `postMessage` uses, so this is the real thing rather
 * than a model of it.
 */

import { describe, expect, it } from 'vitest';
import {
  EdfBudgetError,
  EdfChannelNotFoundError,
  EdfFormatError,
  EdfRangeError,
  EdfScalingError,
  EdfSourceError,
  isEdfError,
} from '../../src/errors.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = (DOCS_PAGES.get('api-errors.md') ?? '').replace(/\s+/g, ' ');

const ERRORS = [
  new EdfFormatError('bad header', { code: 'NOT_AN_EDF_FILE' }),
  new EdfRangeError('out of range', {
    requested: { start: 0, count: 1 },
    available: { start: 0, count: 0 },
  }),
  new EdfSourceError('short read', { offset: 0, requestedLength: 4 }),
  new EdfBudgetError('too big', { requiredBytes: 2, budgetBytes: 1 }),
  new EdfScalingError('no gain', { code: 'SCALE_UNAVAILABLE', signalIndex: 0, label: 'Fp1' }),
  new EdfChannelNotFoundError('no channel', { selector: 'Fp1', availableLabels: [] }),
] as const;

describe('an edfcore error put through the structured-clone algorithm', () => {
  it('is named by its concrete class before the clone', () => {
    for (const error of ERRORS) {
      expect(error.name).toBe(error.constructor.name);
      expect(error.name).not.toBe('Error');
    }
  });

  it('arrives named Error, so a name branch never matches', () => {
    for (const error of ERRORS) {
      expect(structuredClone(error).name).toBe('Error');
    }
  });

  it('keeps the message, and drops the discriminator', () => {
    for (const error of ERRORS) {
      const clone = structuredClone(error);
      expect(clone.message).toBe(error.message);
      expect(typeof clone.stack).toBe('string');
      expect(isEdfError(clone)).toBe(false);
    }
  });

  it('keeps a cause, which is the part of the sentence that was right', () => {
    const cause = new TypeError('underneath');
    const error = new EdfSourceError('outer', { offset: 0, requestedLength: 4, cause });
    expect((structuredClone(error).cause as Error | undefined)?.message).toBe('underneath');
  });

  it('does keep the name of a built-in, which is why the rule is easy to misstate', () => {
    expect(structuredClone(new RangeError('r')).name).toBe('RangeError');
  });
});

describe('the page', () => {
  it('no longer lists name among what a clone keeps', () => {
    expect(PAGE).not.toContain("keeps an Error's `name`, `message`, `stack` and `cause`");
  });

  it('says what arrives instead', () => {
    expect(PAGE).toContain("normalises everything else to `'Error'`");
  });
});
