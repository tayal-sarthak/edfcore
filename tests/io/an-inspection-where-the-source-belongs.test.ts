/**
 * An inspection handed to an entry point that takes a source.
 *
 * `inspectEdf(source)` then `openEdf(...)` is the triage-then-open sequence, and passing the
 * inspection on rather than the source is the slip it invites. It was described as "Object" and
 * answered with the four-adapter list, to a caller who already holds the source they inspected.
 */

import { describe, expect, it } from 'vitest';
import { byteSource, cachedSource, inspectEdf, openEdf, readHeader } from '../../src/index.js';
import { minimalEdf } from '../support/writer.js';

async function refusal(run: () => unknown): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('an inspection passed where the source belongs', () => {
  it.each([
    ['openEdf', (given: unknown) => openEdf(given as never)],
    ['readHeader', (given: unknown) => readHeader(given as never)],
    ['cachedSource', (given: unknown) => cachedSource(given as never)],
  ])('%s() names it and sends the caller back to the source', async (_call, run) => {
    const source = byteSource(minimalEdf());
    const inspection = await inspectEdf(source);
    const thrown = await refusal(() => run(inspection));
    expect(thrown.message).toContain('that is an inspection — what inspectEdf() resolves to');
    expect(thrown.message).toContain('pass the source you inspected');
    expect(await openEdf(source)).toBeDefined();
  });
});
