/**
 * `allowFullDownload` given as text, and the permission it grants being read as withheld.
 *
 * It is compared against a boolean rather than coerced — the rule 0.6.182, 0.6.193 and 0.6.197 each
 * closed for another flag — so `'true'`, `'1'` and `1` all read as OFF.
 *
 * Off is the expensive direction here. This is the one option that says "yes, this server ignores
 * Range; fetch the resource once and serve reads out of it", so text turned the permission off and
 * the read came back as `HTTP_RANGE_IGNORED` with the sentence "edfcore will not silently buffer a
 * recording nobody asked for" — said to the caller who asked for it.
 *
 * `data-sources.md` names `options.byteLength` with `allowFullDownload` as the pair for exactly this
 * kind of server, which is where a value read out of a config lands.
 */

import { describe, expect, it, vi } from 'vitest';
import { httpSource } from '../../src/io/http.js';
import type { HttpResponseLike } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const URL_ = 'https://example.org/study.edf';

/** A server that ignores Range and answers 200 with the whole resource, every time. */
const ignoresRange = (): ReturnType<typeof vi.fn> =>
  vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => FILE.slice().buffer,
      }) as unknown as HttpResponseLike,
  );

const AS_TEXT: ReadonlyArray<readonly [string, unknown]> = [
  ['the string "true"', 'true'],
  ['the string "1"', '1'],
  ['the number 1', 1],
  ['the string "yes"', 'yes'],
];

describe.each(AS_TEXT)('allowFullDownload given as %s', (_name, allowFullDownload) => {
  it('is refused rather than read as a permission withheld', async () => {
    const thrown = await httpSource(URL_, {
      fetch: ignoresRange() as never,
      allowFullDownload: allowFullDownload as never,
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the permission was dropped').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('options.allowFullDownload must be true or false');
    expect(thrown?.message).toContain('Next:');
  });

  it('says what the off reading did, which is refuse the thing it permits', async () => {
    const thrown = await httpSource(URL_, {
      fetch: ignoresRange() as never,
      allowFullDownload: allowFullDownload as never,
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('HTTP_RANGE_IGNORED');
    expect(thrown?.message).toContain('arrive as text');
  });

  it('is refused before a request goes out', async () => {
    const fetch = ignoresRange();
    await httpSource(URL_, {
      fetch: fetch as never,
      allowFullDownload: allowFullDownload as never,
    }).catch(() => undefined);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the boolean itself', () => {
  it('still buffers the resource when it is true', async () => {
    const source = await httpSource(URL_, {
      fetch: ignoresRange() as never,
      allowFullDownload: true,
      byteLength: FILE.byteLength,
    });
    expect(source.byteLength).toBe(FILE.byteLength);
    expect((await source.read(0, 8)).byteLength).toBe(8);
  });

  it('still refuses a range-ignoring server when it is false, and when omitted', async () => {
    await expect(
      httpSource(URL_, { fetch: ignoresRange() as never, allowFullDownload: false }),
    ).rejects.toThrow(/HTTP_RANGE_IGNORED/);
    await expect(httpSource(URL_, { fetch: ignoresRange() as never })).rejects.toThrow(
      /HTTP_RANGE_IGNORED/,
    );
  });

  it('leaves the bare-options refusal saying its own thing', async () => {
    await expect(httpSource(URL_, true as never)).rejects.toThrow(
      /fetch, headers and byteLength are fields on one/,
    );
  });
});
