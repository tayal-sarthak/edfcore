/**
 * A fetch `Response` handed to an entry point that takes a source.
 *
 * `openEdf(await fetch(url))` is what gets written on the line after a download, and it was
 * answered with the four-adapter list, none of which says the object in hand is a Response.
 * `blobSource` already names one; this is the same courtesy where more people meet it.
 */

import { describe, expect, it } from 'vitest';
import { openEdf, readHeader } from '../../src/index.js';

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('a fetch Response passed where the source belongs', () => {
  it.each([
    ['openEdf', (given: unknown) => openEdf(given as never)],
    ['readHeader', (given: unknown) => readHeader(given as never)],
  ])('%s() names it and both ways to read it', async (_call, run) => {
    const thrown = await refusal(() => run(new Response(new Uint8Array(8))));
    expect(thrown.message).toContain('received Response');
    expect(thrown.message).toContain('that is a fetch Response');
    expect(thrown.message).toContain('httpSource(url)');
    expect(thrown.message).toContain('response.arrayBuffer()');
  });

  it('still sends a Blob to blobSource', async () => {
    const thrown = await refusal(() => openEdf(new Blob([new Uint8Array(8)]) as never));
    expect(thrown.message).toContain('that looks like a Blob or a File');
  });
});
