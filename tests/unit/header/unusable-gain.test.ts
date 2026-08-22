/**
 * Four numbers that are all finite, and a gain that is not.
 *
 * The scale is `bitValue * (offset + digital)`, with
 * `bitValue = (physMax - physMin) / (digMax - digMin)` and `offset = physMax / bitValue - digMax`.
 * `header/scale.ts` refuses the obvious degeneracies — an inverted digital range, a zero-width
 * one — and those are well covered. What is not is the case where all four fields parse, all four
 * are finite, and the pair they imply is not.
 *
 * An EDF physical bound is eight bytes of ASCII, which is room for an exponent. So a physical
 * range can UNDERFLOW against the digital range — `0` to `5E-324` over -1..1 puts `bitValue` at
 * the smallest positive double divided by two, which is zero, and `offset` at infinity — or
 * OVERFLOW it, where `-9.9E307` to `9.9E307` makes the numerator exceed float64 before the
 * division happens. Either way `bitValue * (offset + digital)` is NaN or infinite for every
 * sample in the channel: a fabricated gain by another name.
 *
 * Nothing about the file looks wrong. The header parses, the field is in range for its width, and
 * a reader who does not check `signal.scale` gets a column of `NaN` where microvolts should be —
 * which plots as an empty panel, or silently poisons a mean.
 *
 * So the scale is refused exactly as the degenerate cases are, and `decodeDigital` keeps working:
 * the stored integers are still the integers, and only the conversion to physical units is
 * unavailable. That split is the whole reason `toPhysical` is a separate call.
 *
 * What this does NOT distinguish: the `bitValue === 0` clause of the guard from the finiteness
 * clauses beside it. A zero `bitValue` makes `offset` — which divides by it — infinite or NaN, so
 * the finiteness check alone catches every case this can build. The clause states the condition
 * the module is about rather than adding a reachable one, and pinning it would mean asserting on
 * which half of an `||` fired.
 *
 * The negative `samplesPerRecord` beside it is the other shape of "parses, and cannot be used".
 * It is fatal rather than diagnosed, because every later signal's byte offset inside a record is a
 * running sum of this field: a negative one does not make one signal wrong, it makes every signal
 * after it point at the wrong bytes.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../../src/decode/physical.js';
import { EdfFormatError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf, readRecords } from '../../../src/recording.js';
import type { EdfRecording } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

/** One signal whose physical bounds are written as literal text, over a digital range of -1..1. */
const withBounds = (physicalMinimum: string, physicalMaximum: string): Uint8Array =>
  buildEdf({
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'Fp1',
        samplesPerRecord: 4,
        digitalMinimum: -1,
        digitalMaximum: 1,
        raw: { physicalMinimum, physicalMaximum },
      },
    ],
  });

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe.each([
  ['underflows to a zero gain', '0       ', '5E-324  '],
  ['overflows the float64 range', '-9.9E307', '9.9E307 '],
])('a physical range that %s', (_why, physicalMinimum, physicalMaximum) => {
  it('is reported, and no gain is invented for it', async () => {
    const recording = await open(withBounds(physicalMinimum, physicalMaximum));
    const found = recording.header.diagnostics.find(
      (one) => one.code === 'DEGENERATE_PHYSICAL_RANGE',
    );
    expect(found, 'the unusable gain was not reported').toBeDefined();
    // The derived pair, not the four inputs: the inputs all look fine, and printing them alone
    // would leave a reader unable to see what is wrong.
    expect(found?.message).toContain('bitValue is');
    expect(found?.message).toContain('offset is');
    expect(found?.message).toContain('not a usable float64 number');
    expect(found?.expected).toBe('a physical range that defines a finite, non-zero gain');
    // Not a rounding complaint: a range this far outside float64 is a corrupt field.
    expect(found?.message).toContain('corrupt field rather than a calibration');
  });

  it('leaves the signal with no scale, so toPhysical refuses it', async () => {
    const recording = await open(withBounds(physicalMinimum, physicalMaximum));
    const signal = recording.header.signals[0];
    expect(signal?.scale).toBeUndefined();
    expect(() => toPhysical(signal as never, Int32Array.from([0, 1]))).toThrow();
  });

  it('still decodes the stored integers, which is what the split is for', async () => {
    const recording = await open(withBounds(physicalMinimum, physicalMaximum));
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [0],
    });
    expect(chunk.signals[0]?.digital).toHaveLength(4);
    // The advice the diagnostic gives, and it works.
    expect(
      recording.header.diagnostics.find((one) => one.code === 'DEGENERATE_PHYSICAL_RANGE')?.message,
    ).toContain('decodeDigital() still works');
  });
});

describe('a signal declaring a negative number of samples', () => {
  it('is fatal, because every later signal is addressed from a running sum of it', async () => {
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4, raw: { samplesPerRecord: '-4      ' } },
        { label: 'Fp2', samplesPerRecord: 4 },
      ],
    });
    const failure = await open(bytes).then(
      () => undefined,
      (thrown: unknown) => thrown as EdfFormatError,
    );
    expect(failure).toBeInstanceOf(EdfFormatError);
    expect(failure?.message).toContain('NUMERIC_FIELD_INVALID');
    // Says why it cannot be tolerated, rather than only that it is wrong.
    expect(failure?.message).toContain('cannot contribute a negative number of bytes');
    expect(failure?.message).toContain('running sum');
    expect(failure?.diagnostic?.expected).toBe('0 or more samples');
    expect(failure?.diagnostic?.signalIndex).toBe(0);
  });
});
