/**
 * The safety property, for the CLI.
 *
 * `fuzz.test.ts` states it for the library: for any byte sequence, edfcore either parses it or
 * throws an `EdfError` — never a bare `TypeError`, never a hang, never believable garbage. The CLI
 * is a second surface over the same parser, with its own formatting, its own six commands and its
 * own exit codes, and nothing had ever pointed it at bytes nobody chose. Every CLI test in the
 * suite feeds it a file written to make a point.
 *
 * That matters because of how `cli.ts` ends. `main()` catches everything and reports
 * `edfcore: ${error.message}` with exit 1, so a `TypeError` escaping `runCli` does not crash — it
 * arrives at the user as a line with no code, no byte offset and no `Next:` clause, wearing the
 * same prefix a real diagnostic wears. The failure is indistinguishable from a working refusal
 * unless something checks the class.
 *
 * Two properties, over 1,300 cases of random bytes, single-bit flips of a good file, truncation at
 * every length, and each header and per-signal field replaced with something that breaks it:
 *
 * 1. **Every rejection is an `EdfError`.** The class is the whole claim; the message is
 *    `error-fields.test.ts`.
 * 2. **Nothing reaches stdout before a rejection.** `edfcore json big.edf > out.json` either
 *    writes a whole document or writes nothing, so a redirect cannot leave a half-written file
 *    beside a non-zero exit. Every command builds its output and prints it in one go, and this is
 *    what says so.
 *
 * The exit codes are checked for reachability rather than assumed: 0 for a clean file, 1 for one
 * that reads and fails validation, 2 for bad usage — and `parseArgs` over arbitrary argv throws
 * nothing but `CliUsageError`, which is what keeps 2 distinguishable from 1.
 *
 * Seeds are constants, so a counterexample is reproducible.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CliIo, CliUsageError, parseArgs, runCli } from '../../src/cli-run.js';
import { isEdfError } from '../../src/errors.js';
import { flipBit, setHeaderField, setSignalField, truncate } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

const SEEDS = { randomBytes: 0x0c11_0001, bitFlip: 0x0c11_0002, argv: 0x0c11_0003 } as const;

/** Two signals plus an annotations channel, so a corruption has somewhere to land. */
const GOOD = buildEdf({
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});
const SIGNAL_COUNT = 2;

/** The six the usage text lists. `--help` and `--version` are not file commands. */
const COMMANDS = ['header', 'validate', 'events', 'signals', 'gaps', 'json'] as const;

interface Outcome {
  readonly label: string;
  readonly command: string;
  readonly code?: number;
  readonly error?: unknown;
  readonly wroteBeforeThrowing: number;
}

async function invoke(command: string, bytes: Uint8Array, label: string): Promise<Outcome> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(bytes),
    out: (text) => {
      out += text;
    },
    err: () => undefined,
  };
  try {
    const code = await runCli(parseArgs([command, 'x.edf']), io);
    return { label, command, code, wroteBeforeThrowing: 0 };
  } catch (error) {
    return { label, command, error, wroteBeforeThrowing: out.length };
  }
}

/** Every corruption this file runs, each of the six commands over each. */
async function sweep(): Promise<readonly Outcome[]> {
  const outcomes: Outcome[] = [];
  const all = async (label: string, bytes: Uint8Array): Promise<void> => {
    for (const command of COMMANDS) outcomes.push(await invoke(command, bytes, label));
  };

  await fc.assert(
    fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 1200 }), async (bytes) => {
      await all('random bytes', bytes);
    }),
    { seed: SEEDS.randomBytes, numRuns: 40 },
  );

  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: GOOD.byteLength - 1 }),
      fc.integer({ min: 0, max: 7 }),
      async (offset, bit) => {
        await all(`bit ${bit} of byte ${offset}`, flipBit(GOOD, offset, bit));
      },
    ),
    { seed: SEEDS.bitFlip, numRuns: 120 },
  );

  for (let length = 0; length <= GOOD.byteLength; length += 23) {
    await all(`truncated to ${length}`, truncate(GOOD, length));
  }

  for (const [field, text] of [
    ['signalCount', 'xx  '],
    ['recordCount', '-9  '],
    ['recordDuration', '0   '],
    ['headerByteLength', '1   '],
    ['version', 'ZZZ '],
    ['startDate', '99.99.99'],
    ['startTime', '99.99.99'],
  ] as const) {
    await all(`header.${field}`, setHeaderField(GOOD, field, text));
  }

  for (const [field, text] of [
    ['samplesPerRecord', '999999  '],
    ['digitalMinimum', '0       '],
    ['digitalMaximum', '0       '],
    ['physicalMinimum', 'x       '],
    ['label', 'EDF Annotations '],
  ] as const) {
    await all(`signal 0 ${field}`, setSignalField(GOOD, SIGNAL_COUNT, 0, field, text));
  }

  return outcomes;
}

const OUTCOMES = await sweep();

describe('the sweep', () => {
  it('ran enough cases that a passing run is not a vacuous one', () => {
    expect(OUTCOMES.length).toBeGreaterThan(1_000);
    expect(new Set(OUTCOMES.map((outcome) => outcome.command)).size).toBe(COMMANDS.length);
  });

  it('reached both outcomes, so neither property is trivially satisfied', () => {
    expect(OUTCOMES.some((outcome) => outcome.error !== undefined)).toBe(true);
    expect(OUTCOMES.some((outcome) => outcome.code !== undefined)).toBe(true);
  });
});

describe('every rejection', () => {
  it('is an EdfError, never a bare TypeError the user cannot act on', () => {
    const wrong = OUTCOMES.filter(
      (outcome) => outcome.error !== undefined && !isEdfError(outcome.error),
    ).map(
      (outcome) =>
        `${outcome.command} on ${outcome.label}: ` +
        `${(outcome.error as Error)?.constructor?.name}: ${(outcome.error as Error)?.message}`,
    );
    expect(wrong).toEqual([]);
  });

  it('carries the code and the Next clause a diagnostic-derived message has', () => {
    const rejections = OUTCOMES.filter((outcome) => outcome.error !== undefined);
    expect(rejections.length).toBeGreaterThan(100);
    for (const outcome of rejections) {
      const message = (outcome.error as Error).message;
      expect(message, `${outcome.command} on ${outcome.label}`).toMatch(/^\[[A-Z0-9_]+]/);
      expect(message, `${outcome.command} on ${outcome.label}`).toMatch(/Next:/);
    }
  });
});

describe('nothing reaches stdout before a rejection', () => {
  it('so a redirect gets a whole document or an empty file, never half of one', () => {
    const leaked = OUTCOMES.filter((outcome) => outcome.wroteBeforeThrowing > 0).map(
      (outcome) => `${outcome.command} on ${outcome.label}: ${outcome.wroteBeforeThrowing} bytes`,
    );
    expect(leaked).toEqual([]);
  });
});

describe('the exit codes', () => {
  const CLEAN = buildEdf({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 24 }],
  });
  /** Reads perfectly; one signal has no usable scale, so the sweep fails. */
  const UNSCALABLE = buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'EEG Fpz-Cz',
        samplesPerRecord: 4,
        raw: { digitalMinimum: '0', digitalMaximum: '0' },
      },
    ],
  });

  async function codeOf(argv: readonly string[], bytes: Uint8Array): Promise<number> {
    const io: CliIo = {
      readFile: () => Promise.resolve(bytes),
      out: () => undefined,
      err: () => undefined,
    };
    return runCli(parseArgs(argv), io);
  }

  it('are all three reachable, which is what makes the property above non-trivial', async () => {
    expect(await codeOf(['header', 'a.edf'], CLEAN)).toBe(0);
    expect(await codeOf(['validate', 'a.edf'], UNSCALABLE)).toBe(1);
    expect(await codeOf(['nonsense'], CLEAN)).toBe(2);
  });

  it('and every code the sweep returned is one of them', () => {
    for (const outcome of OUTCOMES) {
      if (outcome.code === undefined) continue;
      expect([0, 1, 2], `${outcome.command} on ${outcome.label}`).toContain(outcome.code);
    }
  });
});

describe('parseArgs over arbitrary argv', () => {
  it('throws nothing but CliUsageError, which is what keeps 2 apart from 1', () => {
    const wrong: string[] = [];
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 12 }), { maxLength: 5 }), (argv) => {
        try {
          parseArgs(argv);
        } catch (error) {
          if (!(error instanceof CliUsageError)) {
            wrong.push(`${JSON.stringify(argv)}: ${(error as Error).constructor.name}`);
          }
        }
      }),
      { seed: SEEDS.argv, numRuns: 500 },
    );
    expect(wrong).toEqual([]);
  });
});
