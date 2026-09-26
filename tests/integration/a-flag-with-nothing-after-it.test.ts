/**
 * `--limit` as the last thing on the command line.
 *
 * `Number(undefined)` is `NaN`, so the flag fell into the branch written for a value that is not a
 * count, and that branch printed the value: "received undefined". Nobody typed that word. The shell
 * handed over nothing at all, and a reader looking for `undefined` in their own command finds it
 * nowhere — which is the shape `describe.ts` exists for, one layer down, where a message "names a
 * rule the printed value satisfies" or a value the caller never produced.
 *
 * `ticks.ts` separates the same case for the same reason and states it: "nothing computes undefined,
 * so this is a field that is not there". 0.6.246 gave the blank value — `--limit ""` from an unset
 * variable in quotes — its own sentence one step earlier. This is that variable UNQUOTED: the note
 * above the blank-value branch already describes the route, saying it "would vanish and leave
 * `--limit` last, which the check below already refuses by name". It refuses it, and the name it
 * gave was `undefined`.
 *
 * Nothing else about the flag moves. A real value that is not a count keeps the sentence that names
 * it, including `--patient` and a filename swallowed by the flag — both of which a reader CAN find
 * in what they typed, which is what makes printing them right there and wrong here.
 */

import { describe, expect, it } from 'vitest';
import { CliUsageError, parseArgs } from '../../src/cli-run.js';

describe('--limit with nothing after it', () => {
  it('is bad usage', () => {
    expect(() => parseArgs(['events', 'file.edf', '--limit'])).toThrow(CliUsageError);
  });

  it('says the flag was given no value, rather than printing one', () => {
    let message = '';
    try {
      parseArgs(['events', 'file.edf', '--limit']);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('no value at all');
    expect(message).not.toContain('undefined');
  });

  it('still says what to do, and what the default is', () => {
    expect(() => parseArgs(['events', 'file.edf', '--limit'])).toThrow(
      /Next: pass a count after it/,
    );
    expect(() => parseArgs(['events', 'file.edf', '--limit'])).toThrow(/default of 20/);
  });

  it('reads the same way whether or not a file was named', () => {
    const message = (argv: readonly string[]): string => {
      try {
        parseArgs(argv);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    };
    expect(message(['events', '--limit'])).toBe(message(['events', 'file.edf', '--limit']));
  });
});

describe('the values a reader can find in what they typed', () => {
  it('are still printed, because there they are the point', () => {
    for (const written of ['abc', '--patient', 'file.edf', '-1', '1.5']) {
      expect(() => parseArgs(['events', 'file.edf', '--limit', written])).toThrow(
        new RegExp(`received ${written.replace('-', '\\-')}`),
      );
    }
  });

  it('and a blank value keeps the sentence 0.6.246 wrote for it', () => {
    expect(() => parseArgs(['events', 'file.edf', '--limit', ''])).toThrow(/blank value/);
    expect(() => parseArgs(['events', 'file.edf', '--limit', ' '])).toThrow(/blank value/);
  });
});

describe('a real limit', () => {
  it('is still read, and still consumes its value', () => {
    expect(parseArgs(['events', 'file.edf', '--limit', '5'])).toMatchObject({
      command: 'events',
      file: 'file.edf',
      limit: 5,
    });
  });

  it('is still allowed to be zero, which asks for the counts without the rows', () => {
    expect(parseArgs(['events', 'file.edf', '--limit', '0']).limit).toBe(0);
  });
});
