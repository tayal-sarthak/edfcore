/**
 * `edfcore json` reports when the recording started.
 *
 * It is documented as "the header as JSON, for piping into jq" and it was the only command a
 * script could not get the recording's date and time out of. `header` prints them on its second
 * line and needs no flag; `signals` is per-signal, `gaps` is about onsets, `events` is about
 * annotations, and `validate` is about conformance. The machine-readable one had the geometry,
 * the signals and the diagnostic codes, and no start.
 *
 * That is worse than an omission because of where the package sends people. Any file with a
 * two-digit year — which is every file whose startdate field is conformant — earns
 * `DATE_CLIPPED_TO_1985_2084`, and its `Next:` clause says to read the four-digit year the EDF+
 * recording identification spells out. `edfcore json` reported the code and not the field it
 * points at, so the advice could be read from the output and not acted on from it.
 *
 * Both sources are reported rather than resolved away, and both for the reason 0.3.17 gives: a
 * clock the file did not state is a substituted midnight, midnight is an entirely believable start
 * for a sleep study, and without `clockSource` those two are one value. `null` rather than an
 * absent key, because JSON drops `undefined` and `.start.clock` should answer.
 *
 * The other half of this change is that `formatHeader` stopped carrying its own clock renderer.
 * `formatClockTime` has existed in `header/dates.ts` since the clock did; the copy in the
 * formatter agreed with it on every input, which is exactly the state the DATE half was in until
 * `985-04-24` printed eight lines above `0985-04-24`. Both commands render through the one
 * function now, and this file checks they say the same thing on every shape.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { setHeaderField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

interface Start {
  readonly date: string | null;
  readonly dateSource: string;
  readonly clock: string | null;
  readonly clockSource: string;
}

const PLAIN = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
});

/** A starttime field that fails its grammar, so the clock is a substituted midnight. */
const NO_CLOCK = setHeaderField(PLAIN, 'startTime', 'xx.yy.zz');

/** The EDF+ recording identification carrying the four-digit year the header field cannot. */
const FOUR_DIGIT_YEAR = setHeaderField(
  setHeaderField(PLAIN, 'recordingId', 'Startdate 24-APR-2095 X X X'),
  'startDate',
  '24.04.95',
);

async function json(
  bytes: Uint8Array,
  argv: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: () => {},
    readFile: async () => bytes,
  };
  const code = await runCli(parseArgs(['json', ...argv, 'a.edf']), io);
  expect(code).toBe(0);
  return JSON.parse(chunks.join('')) as Record<string, unknown>;
}

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a starttime that failed its grammar', NO_CLOCK],
  ['a four-digit year in the recording identification', FOUR_DIGIT_YEAR],
];

describe('the matrix this file sweeps', () => {
  it('is the twelve shapes it was written against, plus two built here', () => {
    expect(AWKWARD).toHaveLength(12);
    expect(FILES).toHaveLength(14);
  });
});

describe.each(FILES)('json for %s', (_name, bytes) => {
  it('reports a start, and it is the one the library resolved', async () => {
    const recording = await openEdf(byteSource(bytes));
    const start = (await json(bytes)).start as Start;
    const resolved = recording.header.startTime;

    expect(start.dateSource).toBe(resolved.dateSource);
    expect(start.clockSource).toBe(resolved.clockSource);
    expect(start.date === null).toBe(resolved.resolvedDate === undefined);
    expect(start.clock === null).toBe(resolved.clockSource === 'none');
  });

  it('spells it the way `edfcore header` spells it, through the one renderer', async () => {
    const recording = await openEdf(byteSource(bytes));
    const start = (await json(bytes)).start as Start;
    const line = formatHeader(recording.header)
      .split('\n')
      .find((text) => text.startsWith('start '));
    if (line === undefined) throw new Error('formatHeader stopped printing a start line');

    expect(line).toContain(start.date ?? 'unknown');
    expect(line).toContain(start.clock ?? 'unknown');
  });
});

describe('the two fields that say how much to trust it', () => {
  it('tells a refused clock from a file that starts at midnight', async () => {
    const refused = (await json(NO_CLOCK)).start as Start;
    expect(refused).toMatchObject({ clock: null, clockSource: 'none' });

    // The same output shape for a file that really does start at midnight, and the source is the
    // only thing separating them — which is the whole reason `clockSource` exists.
    const midnight = (await json(setHeaderField(PLAIN, 'startTime', '00.00.00'))).start as Start;
    expect(midnight).toMatchObject({ clock: '00:00:00', clockSource: 'headerField' });
  });

  it('names the recording identification when that is where the year came from', async () => {
    // The file DATE_CLIPPED_TO_1985_2084 sends a reader to the recording identification for, now
    // answerable from the command that reported the diagnostic.
    const document = await json(FOUR_DIGIT_YEAR);
    const start = document.start as Start;
    expect(start).toMatchObject({ date: '2095-04-24', dateSource: 'recordingIdField' });

    const codes = (document.diagnostics as Array<{ code: string }>).map((one) => one.code);
    expect(codes).toContain('DATE_FIELDS_DISAGREE');
  });

  it('says headerField on the ordinary file, so the check above is not vacuous', async () => {
    expect((await json(PLAIN)).start as Start).toMatchObject({
      dateSource: 'headerField',
      clockSource: 'headerField',
    });
  });
});

describe('what the addition must not have moved', () => {
  it('leaves every key the command already emitted', async () => {
    const document = await json(PLAIN);
    expect(Object.keys(document)).toEqual([
      'variant',
      'recordCount',
      'recordDurationSeconds',
      'spanSeconds',
      'coveredSeconds',
      'start',
      'signals',
      'diagnostics',
    ]);
  });

  it('still gates the identification behind --patient, and the start never was', async () => {
    expect(await json(PLAIN)).not.toHaveProperty('patient');
    expect(await json(PLAIN, ['--patient'])).toHaveProperty('patient');
    // `header` prints the start with no flag either. It is the recording's clock, not a person.
    expect((await json(PLAIN)).start).not.toBeUndefined();
  });
});
