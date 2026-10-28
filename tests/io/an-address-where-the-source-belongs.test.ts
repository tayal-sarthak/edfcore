/**
 * An address handed to an entry point that takes a source.
 *
 * `assertByteSource` answered every string with "that looks like a path — use fileSource(path)",
 * so `openEdf('https://…')` was sent to the adapter that reads a disk, which then refuses the
 * scheme and names `httpSource`. One hop of advice that only leads to the next refusal.
 */

import { describe, expect, it } from 'vitest';
import { inspectEdf, openEdf, readHeader } from '../../src/index.js';

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('an address passed where the source belongs', () => {
  it.each([
    ['openEdf', (given: unknown) => openEdf(given as never)],
    ['readHeader', (given: unknown) => readHeader(given as never)],
  ])('%s() names httpSource for it', async (_call, run) => {
    for (const address of ['https://example.org/a.edf', 'HTTP://example.org/a.edf']) {
      const thrown = await refusal(() => run(address));
      expect(thrown.message).toContain('that is an address — use httpSource(url)');
      expect(thrown.message).not.toContain('fileSource');
    }
  });

  it('inspectEdf() rethrows the same advice rather than absorbing it', async () => {
    const thrown = await refusal(() => inspectEdf('https://example.org/a.edf' as never));
    expect(thrown.message).toContain('httpSource(url)');
  });

  it('keeps the path advice for a path', async () => {
    const thrown = await refusal(() => openEdf('/data/night.edf' as never));
    expect(thrown.message).toContain('that looks like a path');
  });
});
