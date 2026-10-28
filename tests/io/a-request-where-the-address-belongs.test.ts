/**
 * A fetch `Request` handed to `httpSource`.
 *
 * A `Request` carries its address on `.url` rather than `.href`, so it was refused as "an object"
 * and told to pass the address "as a string, or as new URL(address)" — true, and silent about the
 * part that matters: a Request is how headers and credentials travel, and this adapter builds its
 * own range requests. Unwrapping `.url` quietly would drop them, so it stays refused, and now says
 * where each half goes. A plain `{ url }` object is not a Request and keeps the plain advice.
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';

const offline = { fetch: () => Promise.reject(new Error('no network')) };

describe('a Request where the address belongs', () => {
  it('names it a Request and sends the headers to options.fetch', async () => {
    const request = new Request('https://example.test/recording.edf', {
      headers: { Authorization: 'Bearer token' },
    });
    const refusal = httpSource(request as never, offline);
    await expect(refusal).rejects.toThrow('that is a fetch Request');
    await expect(httpSource(request as never, offline)).rejects.toThrow('request.url');
    await expect(httpSource(request as never, offline)).rejects.toThrow('options.fetch');
  });

  it('keeps the plain advice for an object that only has a url', async () => {
    await expect(
      httpSource({ url: 'https://example.test/recording.edf' } as never, offline),
    ).rejects.toThrow('new URL(address)');
  });

  it('gets past the address with the url the Request carries', async () => {
    const request = new Request('https://example.test/recording.edf');
    await expect(httpSource(request.url, offline)).rejects.not.toThrow('needs a URL string');
  });
});
