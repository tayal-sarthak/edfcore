/**
 * When the bytes are an archive, the refusal says which one.
 *
 * `NOT_AN_EDF_FILE` is the diagnostic an unknown file earns, and its `Next:` clause has always
 * said "a gzip, zip or vendor container has to be unpacked before edfcore sees it". That is a menu,
 * offered while holding the two bytes that answer it: `1f 8b` is a gzip and nothing else, and the
 * message prints those bytes on the same line it asks the reader to guess.
 *
 * It is also the likeliest first meeting with this package. Recordings travel compressed —
 * PhysioNet ships `.zip`, teuniz.net ships `.zip`, a shared study arrives as `.gz` — so pointing
 * edfcore at the download rather than at what is inside it is the ordinary mistake, not an exotic
 * one. `edfcore header study.edf.gz` now says it is a gzip and to unpack it.
 *
 * Only archive formats, and only by magic number. Naming a container is a fact about the first
 * bytes; guessing a vendor's binary EEG format from two bytes would be a claim about the whole
 * file, and the generic clause still covers everything unrecognised — checked below, because a
 * table that matched everything would be worse than the menu.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

/** 300 bytes so the header read succeeds and the version block is what refuses. */
const withMagic = (magic: readonly number[]): Uint8Array =>
  Uint8Array.from([...magic, ...new Array(400 - magic.length).fill(0x41)]);

const ARCHIVES: ReadonlyArray<readonly [string, readonly number[], string]> = [
  ['gzip', [0x1f, 0x8b, 0x08, 0x00], 'a gzip'],
  ['zip', [0x50, 0x4b, 0x03, 0x04], 'a zip'],
  ['empty zip', [0x50, 0x4b, 0x05, 0x06], 'an empty zip'],
  ['bzip2', [0x42, 0x5a, 0x68, 0x39], 'a bzip2'],
  ['xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], 'an xz'],
  ['zstd', [0x28, 0xb5, 0x2f, 0xfd], 'a zstd'],
  ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 'a 7-Zip archive'],
];

async function refusal(bytes: Uint8Array): Promise<string> {
  try {
    await openEdf(byteSource(bytes));
  } catch (error) {
    if (!isEdfError(error)) throw error;
    return error.message;
  }
  throw new Error('these bytes were accepted as a recording');
}

describe.each(ARCHIVES)('%s', (_name, magic, said) => {
  it('is named, rather than listed among the possibilities', async () => {
    const message = await refusal(withMagic(magic));
    expect(message).toContain(`Those first bytes are ${said}.`);
    expect(message).toContain(`Next: unpack ${said} and open the EDF or BDF file inside it`);
  });

  it('drops the menu, which is what made the advice unactionable', async () => {
    const message = await refusal(withMagic(magic));
    expect(message).not.toContain('a gzip, zip or vendor container');
  });

  it('says the same thing through inspectEdf, which is the triage entry point', async () => {
    const inspection = await inspectEdf(byteSource(withMagic(magic)));
    expect(inspection.ok).toBe(false);
    const found = inspection.diagnostics.find((one) => one.code === 'NOT_AN_EDF_FILE');
    expect(found?.message).toContain(said);
  });
});

describe('anything else', () => {
  it('still gets the general advice, so the table is not claiming to know', async () => {
    // A text file, and bytes chosen to sit near a magic number without being one.
    for (const bytes of [
      withMagic([0x44, 0x6f, 0x77, 0x6e]),
      withMagic([0x1f, 0x8c]),
      withMagic([0x50, 0x4b, 0x03, 0x05]),
      withMagic([0x00, 0x00, 0x00, 0x00]),
    ]) {
      const message = await refusal(bytes);
      expect(message).toContain('a gzip, zip or vendor container has to be unpacked');
      expect(message).not.toContain('Those first bytes are');
    }
  });

  it('is most files, and a real recording is not refused at all', async () => {
    const good = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    await expect(openEdf(byteSource(good))).resolves.toBeDefined();
  });
});

describe('the message contract', () => {
  it('still names the field, the bytes and a Next: clause', async () => {
    const message = await refusal(withMagic([0x1f, 0x8b]));
    expect(message).toContain('version field (8 bytes at offset 0)');
    expect(message).toContain('bytes 0x1f 0x8b');
    expect(message).toContain('EDF specification, header record bytes 0-7');
    expect(message).toContain('Next: ');
  });

  it('is the same code either way, because it is the same refusal', async () => {
    for (const bytes of [withMagic([0x1f, 0x8b]), withMagic([0x44, 0x6f, 0x77, 0x6e])]) {
      const inspection = await inspectEdf(byteSource(bytes));
      expect(inspection.diagnostics.map((one) => one.code)).toContain('NOT_AN_EDF_FILE');
    }
  });
});
