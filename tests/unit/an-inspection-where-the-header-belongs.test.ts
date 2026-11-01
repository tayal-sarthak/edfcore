/**
 * An inspection handed to the header lookups where its header belongs.
 *
 * `inspectEdf` is the documented first call on an unknown file, and a caller deciding which
 * channels to read next looks them up in what it returned — `getSignal(inspection, 'A1')`. It was
 * told to pass `recording.header`, which a caller who has only triaged the file does not have.
 */

import { describe, expect, it } from 'vitest';
import { findSignals, getSignal, matchSignals } from '../../src/header/lookup.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

describe('an inspection passed as the header', () => {
  it.each([
    ['getSignal', (h: unknown) => getSignal(h as never, 0)],
    ['findSignals', (h: unknown) => findSignals(h as never, 'A1')],
    ['matchSignals', (h: unknown) => matchSignals(h as never, /A/)],
  ] as const)('%s() points at inspection.header', async (name, call) => {
    const inspection = await inspectEdf(byteSource(minimalEdf()));
    expect(() => call(inspection)).toThrow(
      `${name}(): that is an inspection, not a header. Next: pass inspection.header`,
    );
  });
});
