/**
 * `edfcore json` reports the sub-second start, which is the number joining its two clocks.
 *
 * The document carries two timebases and never said how far apart they are. `start.date` and
 * `start.clock` are header fields, on the header's timebase. `spanSeconds`, `coveredSeconds` and
 * the onsets `edfcore events` prints are on record 0's, where `t = 0` is the start of record 0.
 * Record 0's timekeeping TAL holds the distance between them — in [0, 1) — and that was the one
 * number a script could not get out of the machine-readable output.
 *
 * So the obvious composition was wrong. Take the clock from `json`, take an onset from `events`,
 * add them, and every event on a file with an offset lands early by up to a second. Silently, and
 * only on those files: the format's one piece of sub-second timing, as `edf-format.md` calls it,
 * dropped by the command written to be piped into something else.
 *
 * `formatHeader` cannot print it and this command can. A header alone does not know the offset —
 * it is in a record — and `edfcore json` opens the recording, so it has already paid for the probe
 * that reads it. That is the same division 0.3.94 drew for the probe's diagnostics.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';

interface Start {
  readonly clock: string | null;
  readonly clockSource: string;
  readonly offsetSeconds: number;
}

async function run(command: string, bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => bytes,
  };
  await runCli(parseArgs([command, 'a.edf']), io);
  return chunks.join('');
}

const start = async (bytes: Uint8Array): Promise<Start> =>
  (JSON.parse(await run('json', bytes)) as { start: Start }).start;

describe('the matrix this file sweeps', () => {
  it('is the seventeen shapes', () => {
    expect(AWKWARD).toHaveLength(17);
  });
});

describe.each(AWKWARD.map((file) => [file.name, file.bytes] as const))('for %s', (_name, bytes) => {
  it('reports the offset the library holds', async () => {
    const recording = await openEdf(byteSource(bytes));
    expect((await start(bytes)).offsetSeconds).toBe(recording.timeline.startOffsetSeconds);
  });

  it('reports one in [0, 1), which is what a sub-second start is', async () => {
    const { offsetSeconds } = await start(bytes);
    expect(offsetSeconds).toBeGreaterThanOrEqual(0);
    expect(offsetSeconds).toBeLessThan(1);
  });
});

describe('the shape that has one', () => {
  const withOffset = AWKWARD.find((file) => file.name === 'a gap and a sub-second start at once');

  it('is in the matrix, so this file is not sweeping seventeen zeroes', () => {
    expect(withOffset).toBeDefined();
  });

  it('carries the quarter second the header field cannot express', async () => {
    const bytes = withOffset?.bytes as Uint8Array;
    const { clock, clockSource, offsetSeconds } = await start(bytes);
    // The header field is whole seconds — `hh.mm.ss`, eight bytes — so the clock is 10:00:00 on a
    // recording whose first record begins a quarter of a second later. Both numbers, not one.
    expect(clock).toBe('10:00:00');
    expect(clockSource).toBe('headerField');
    expect(offsetSeconds).toBe(0.25);
  });

  it('is the offset `edfcore events` measures its onsets against', async () => {
    const bytes = withOffset?.bytes as Uint8Array;
    const recording = await openEdf(byteSource(bytes));
    // The two annotation axes differ by exactly this number, which is why the document needs it:
    // `events` prints the record-0 axis and `json` prints the header clock.
    expect(recording.timeline.startOffsetSeconds).toBe(0.25);
    expect((await start(bytes)).offsetSeconds).toBe(recording.timeline.startOffsetSeconds);
  });
});

describe('what the matrix would have hidden', () => {
  it('is sixteen shapes that start on the second, so one file carries the whole case', async () => {
    const offsets = await Promise.all(
      AWKWARD.map(async (file) => (await start(file.bytes)).offsetSeconds),
    );
    expect(offsets.filter((one) => one === 0)).toHaveLength(16);
    expect(offsets.filter((one) => one > 0)).toHaveLength(1);
  });
});
