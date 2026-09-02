/**
 * `edfcore json` says enough to reach physical units, and enough to name a channel.
 *
 * It emitted `physicalDimension` and nothing that gets you to it. A reader learned the samples were
 * in microvolts and had no gain to apply, so the one thing a script most wants from a header —
 * turn these stored integers into the units the file names — needed a second tool. `edfcore header`
 * printed the range to a person the whole time.
 *
 * The four declared numbers are the file's own; `scale` is the derived gain, and it is absent
 * rather than null when the header has none — a degenerate or inverted range, or the `Filtered`
 * dimension. That is the convention `sampleRateHz` already uses here for the legal zero-duration
 * file, and it is the honest shape: `JSON.stringify` drops `undefined`, and a reader who checks for
 * the key gets the answer the library gives, which is that there is no gain to apply.
 *
 * The diagnostics gained `signalIndex` for the same reason. A real file earns one code many times —
 * `chb01_01.edf` reports `LABEL_CONVENTION_NONCONFORMANT` twenty-three times, once per channel — so
 * a script could count them and not name one. A number rather than the field's bytes:
 * `json-command-privacy.test.ts` holds the line that this command emits no diagnostic text, because
 * an identification diagnostic quotes the name it complains about.
 *
 * The proof that it is enough is a conversion done from the document alone, checked against
 * `toPhysical` on the same samples. Anything less would be checking that the keys exist.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';

interface JsonSignal {
  readonly index: number;
  readonly kind: string;
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
  readonly scale?: { readonly bitValue: number; readonly offset: number };
}

interface Report {
  readonly signals: readonly JsonSignal[];
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly signalIndex?: number }>;
}

async function json(bytes: Uint8Array): Promise<Report> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: () => {},
    readFile: async () => bytes,
  };
  expect(await runCli(parseArgs(['json', 'a.edf']), io)).toBe(0);
  return JSON.parse(chunks.join('')) as Report;
}

describe('the matrix this file sweeps', () => {
  it('is the seventeen shapes it was written against', () => {
    expect(AWKWARD).toHaveLength(17);
  });
});

describe.each(AWKWARD)('$name', ({ bytes }) => {
  it('reports the range the library parsed, for every signal', async () => {
    const { header } = await openEdf(byteSource(bytes));
    const { signals } = await json(bytes);
    expect(signals).toHaveLength(header.signals.length);

    for (const [position, signal] of header.signals.entries()) {
      const printed = signals[position];
      expect(printed).toMatchObject({
        index: signal.index,
        physicalMinimum: signal.physicalMinimum,
        physicalMaximum: signal.physicalMaximum,
        digitalMinimum: signal.digitalMinimum,
        digitalMaximum: signal.digitalMaximum,
      });
    }
  });

  it('reports the gain when there is one, and omits the key when there is not', async () => {
    const { header } = await openEdf(byteSource(bytes));
    const { signals } = await json(bytes);
    for (const [position, signal] of header.signals.entries()) {
      const printed = signals[position];
      expect({
        index: signal.index,
        has: Object.hasOwn(printed ?? {}, 'scale'),
      }).toEqual({ index: signal.index, has: signal.scale !== undefined });
      if (signal.scale !== undefined) expect(printed?.scale).toEqual(signal.scale);
    }
  });

  it('names the signal a diagnostic is about, where the library names one', async () => {
    const { header } = await openEdf(byteSource(bytes));
    const { diagnostics } = await json(bytes);
    const printed = diagnostics.slice(0, header.diagnostics.length);
    for (const [position, diagnostic] of header.diagnostics.entries()) {
      expect({
        code: diagnostic.code,
        has: Object.hasOwn(printed[position] ?? {}, 'signalIndex'),
      }).toEqual({ code: diagnostic.code, has: diagnostic.signalIndex !== undefined });
      if (diagnostic.signalIndex !== undefined) {
        expect(printed[position]?.signalIndex).toBe(diagnostic.signalIndex);
      }
    }
  });
});

describe('a conversion done from the document alone', () => {
  it('agrees with toPhysical on the same samples', async () => {
    const file = AWKWARD.find((one) => one.name === 'plain EDF, one signal');
    if (file === undefined) throw new Error('the matrix lost its plain file');

    const recording = await openEdf(byteSource(file.bytes));
    const { signals } = await json(file.bytes);
    const printed = signals.find((one) => one.kind === 'data');
    if (printed?.scale === undefined) throw new Error('the plain file lost its gain');

    const read = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [printed.index],
    });
    const digital = read.signals[0]?.digital;
    if (digital === undefined) throw new Error('no samples to convert');

    // `bitValue * (offset + digital)` — EDFlib's form, which `physical-values.md` says must not be
    // rearranged. A reader with this document has the two numbers and the expression.
    const fromDocument = Float64Array.from(
      digital,
      (value) =>
        (printed.scale as { bitValue: number; offset: number }).bitValue *
        ((printed.scale as { bitValue: number; offset: number }).offset + value),
    );
    const signal = recording.header.signals[printed.index];
    if (signal === undefined) throw new Error('no signal');

    expect(fromDocument).toEqual(toPhysical(signal, digital));
    expect(fromDocument.length).toBeGreaterThan(0);
  });

  it('has a shape with no gain to convert, so the omission is reachable', async () => {
    const file = AWKWARD.find((one) => one.name === 'a signal with no usable scale');
    if (file === undefined) throw new Error('the matrix lost its scaleless file');
    const { signals } = await json(file.bytes);
    expect(signals.some((one) => !Object.hasOwn(one, 'scale'))).toBe(true);
  });

  it('has a shape whose diagnostics name a signal, so that check is not vacuous', async () => {
    const file = AWKWARD.find((one) => one.name === 'duplicate channel labels');
    if (file === undefined) throw new Error('the matrix lost its duplicate-label file');
    const { diagnostics } = await json(file.bytes);
    expect(diagnostics.some((one) => one.signalIndex !== undefined)).toBe(true);
  });
});
