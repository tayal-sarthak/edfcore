/**
 * `formatValidationReport(report, { header: readHeader(source) })`.
 *
 * The forgotten-await sweep of 0.6.229 through 0.6.239 reached every published call that takes a
 * header, and 0.6.238 recorded it as closed: "every header-taking call now names the keyword". That
 * was true of the arguments. `options.header` is the one FIELD in the package that holds a header,
 * so it is the one place a sweep over entry points could not reach by walking their parameters.
 *
 * It is also the field where the keyword is likeliest to be in the line already and in the wrong
 * place. This option's own note says it "is the one a caller adds last, to a call that already
 * worked" — and the call it is added to is awaited, so a reader who writes
 * `{ header: readHeader(source) }` has `await` on their screen and no reason to look at it.
 *
 * What they were told: "options.header is not a header — nothing on it carries the labels this names
 * the rows with". True of a pending Promise, and of a chunk, a recording, a number and `{}`. The
 * advice then named `recording.header`, which a caller holding a bare header — the kind `readHeader`
 * hands back, with no recording around it — does not have.
 *
 * The existing sentence is kept for the shapes it was written for: a chunk, whose `signals` entries
 * carry samples rather than labels, is the one 0.6.183 and 0.6.186 settled this rule for.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { ValidationReport } from '../../src/types.js';
import { formatValidationReport, validateRecording } from '../../src/validate.js';
import { minimalEdfPlus } from '../support/writer.js';

const bytes = minimalEdfPlus();

type Format = (report: unknown, options: unknown) => string;
const format = formatValidationReport as unknown as Format;

const refusal = (call: () => unknown): string => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

async function report(): Promise<ValidationReport> {
  return validateRecording(await openEdf(byteSource(bytes)));
}

describe('the header option, one keyword short', () => {
  it('is named as a pending Promise rather than as not a header', async () => {
    const rep = await report();
    const pending = readHeader(byteSource(bytes));
    const message = refusal(() => format(rep, { header: pending }));
    expect(message).toContain('options.header is a pending Promise');
    expect(message).not.toContain('nothing on it carries the labels');
    await pending;
  });

  it('names the call that produced it and what it resolves to', async () => {
    const rep = await report();
    const pending = readHeader(byteSource(bytes));
    const message = refusal(() => format(rep, { header: pending }));
    expect(message).toContain('readHeader(source) is async');
    expect(message).toContain('resolves to rather than what it returns');
    await pending;
  });

  it('does not send a caller to a field they may not have', async () => {
    const rep = await report();
    const pending = readHeader(byteSource(bytes));
    const message = refusal(() => format(rep, { header: pending }));
    // `readHeader` hands back a bare header with no recording around it.
    expect(message).toContain('await it once into a variable');
    await pending;
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const rep = await report();
    const pending = readHeader(byteSource(bytes));
    let thrown: unknown;
    try {
      format(rep, { header: pending });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    await pending;
  });

  it('is never awaited, settled or subscribed to', async () => {
    const rep = await report();
    const neverSettles = new Promise<never>(() => {});
    expect(refusal(() => format(rep, { header: neverSettles }))).toContain('a pending Promise');
  });
});

describe('the shapes the old sentence was written for', () => {
  it('still hear it — a chunk carries signals with no labels on them', async () => {
    const rep = await report();
    const recording = await openEdf(byteSource(bytes));
    const [chunk] = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
    });
    expect(refusal(() => format(rep, { header: chunk }))).toContain(
      'nothing on it carries the labels',
    );
  });

  it('still hear it — a recording is one field out', async () => {
    const rep = await report();
    const recording = await openEdf(byteSource(bytes));
    expect(refusal(() => format(rep, { header: recording }))).toContain(
      'nothing on it carries the labels',
    );
  });

  it('still hear it — a bare value is not a header either', async () => {
    const rep = await report();
    expect(refusal(() => format(rep, { header: 0 }))).toContain('is not a header');
    expect(refusal(() => format(rep, { header: {} }))).toContain('is not a header');
  });
});

describe('the header once it has resolved', () => {
  it('still names the rows with its labels', async () => {
    const rep = await report();
    const header = await readHeader(byteSource(bytes));
    const text = formatValidationReport(rep, { header });
    expect(text).toContain(header.signals[0]?.label ?? '');
  });

  it('and omitting the option still reads `signal 0`', async () => {
    const rep = await report();
    expect(() => formatValidationReport(rep)).not.toThrow();
  });
});
