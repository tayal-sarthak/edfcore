/**
 * `STARTTIME_UNPARSEABLE`, raised twice for one condition, and the field only one of them named.
 *
 * When the `hh.mm.ss` field fails its grammar, `startTime.clock` holds a substituted midnight —
 * the type admits no absent clock — and `startTime.clockSource` becomes `'none'`. That second
 * field is the entire way a program tells a refused clock from a file that genuinely starts at
 * midnight, which is an ordinary start for a sleep study. `types.ts` says so beside the field,
 * `codes.ts` says so beside the code, and `validate.ts`'s copy of this diagnostic says so in its
 * `Next:` clause.
 *
 * The parser's copy did not. It named `startTime.clock` and `header.raw.startTime` and stopped —
 * and the parser's is the one every `openEdf` and `readHeader` caller sees, without running a
 * conformance sweep. A reader following it had the substituted value and the raw bytes, and no
 * way to branch (fixed in 0.6.66).
 *
 * The two emissions are checked against each other rather than against a sentence written here,
 * so the next divergence fails this too.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { validateHeader } from '../../src/validate.js';
import { setHeaderField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

const BROKEN_CLOCK = setHeaderField(
  buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  }),
  'startTime',
  'zz.zz.zz',
);

const MIDNIGHT = setHeaderField(
  buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  }),
  'startTime',
  '00.00.00',
);

const header = (bytes: Uint8Array) => parseHeader(bytes, bytes.length);

const messageFor = (diagnostics: readonly { code: string; message: string }[]): string => {
  const found = diagnostics.find((d) => d.code === 'STARTTIME_UNPARSEABLE');
  expect(found, 'no STARTTIME_UNPARSEABLE was reported').toBeDefined();
  return found?.message ?? '';
};

describe('the two files the field distinguishes', () => {
  it('look identical on startTime.clock', () => {
    expect(header(BROKEN_CLOCK).startTime.clock).toEqual(header(MIDNIGHT).startTime.clock);
    expect(header(BROKEN_CLOCK).startTime.secondsSinceMidnight).toBe(
      header(MIDNIGHT).startTime.secondsSinceMidnight,
    );
  });

  it('differ only on clockSource', () => {
    expect(header(BROKEN_CLOCK).startTime.clockSource).toBe('none');
    expect(header(MIDNIGHT).startTime.clockSource).toBe('headerField');
  });

  it('and only one of them is reported at all', () => {
    const codes = header(MIDNIGHT).diagnostics.map((d) => d.code);
    expect(codes).not.toContain('STARTTIME_UNPARSEABLE');
  });
});

describe('the two places the diagnostic is raised', () => {
  it('both name the field that separates them', () => {
    const fromParser = messageFor(header(BROKEN_CLOCK).diagnostics);
    const fromSweep = messageFor(validateHeader(header(BROKEN_CLOCK)));
    for (const message of [fromParser, fromSweep]) {
      expect(message).toContain('startTime.clockSource');
      expect(message).toContain('"none"');
    }
  });

  it('are the same finding, so a reader meeting either can branch', () => {
    const fromParser = messageFor(header(BROKEN_CLOCK).diagnostics);
    expect(fromParser).toContain('startTime.clock reports 00:00:00');
    expect(fromParser).toContain('header.raw.startTime');
  });
});
