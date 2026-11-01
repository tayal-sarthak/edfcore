/**
 * A header handed to an entry point that takes a source.
 *
 * `buildTimeline(source, header)` takes the two in that order and `decodeAnnotations(header, …)`
 * the other, so the header lands first by habit; `openEdf(header)` is the same reach from a
 * reader who already parsed one. Each was answered with the four-adapter list, none of which is
 * about a header.
 */

import { describe, expect, it } from 'vitest';
import { buildTimeline, inspectEdf, openEdf, readHeader } from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import { minimalEdf } from '../support/writer.js';

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('a header passed where the source belongs', () => {
  it.each([
    ['openEdf', (given: unknown) => openEdf(given as never)],
    ['readHeader', (given: unknown) => readHeader(given as never)],
    ['inspectEdf', (given: unknown) => inspectEdf(given as never)],
  ])('%s() names it', async (_call, run) => {
    const header = await readHeader(byteSource(minimalEdf()));
    const thrown = await refusal(() => run(header));
    expect(thrown.message).toContain(
      'Next: that is a header — what reading a source produces — so pass the source it came from',
    );
  });

  it('buildTimeline() names it when the two arguments are swapped', async () => {
    const source = byteSource(minimalEdf());
    const header = await readHeader(source);
    const thrown = await refusal(() => buildTimeline(header as never, source as never));
    expect(thrown.message).toContain('that is a header');
  });
});
