/**
 * How long a timestamp field is allowed to be, and what happens past that.
 *
 * A TAL's onset and duration are digits with no declared length: the grammar ends them with a
 * structural byte, so their size is whatever the writer put between two markers. In a region that
 * is 30 bytes on one file and 60 kilobytes on another, "whatever the writer put there" is not a
 * bound, and both fields are decoded from latin-1 and parsed into a bigint before anything about
 * their value is known.
 *
 * `MAX_TIMESTAMP_FIELD_CHARS` is that bound: forty characters, which is more than any time in
 * 100 ns ticks needs and far less than a record. Both fields carry the check — the onset's is
 * exercised, the duration's was not — and they matter for different reasons. An over-long onset
 * is a malformed TAL. An over-long DURATION arrives after a perfectly good onset, which is the
 * shape that gets through a reader's attention: the TAL looks like a real event right up to the
 * separator.
 *
 * The guard sits BEFORE the decode, which is the property worth having. Past it, a region full of
 * digits between two markers is a bigint the size of the region, parsed on every record of every
 * read that touches annotations.
 *
 * A skipped TAL is skipped alone. The region parser continues from the terminator, so the event
 * after a hostile one is still read — which is what stops one bad field in a long recording from
 * costing every annotation after it.
 */

import { describe, expect, it } from 'vitest';
import { parseTalRegion } from '../../../src/tal/grammar.js';

const MARK = 0x14;
const SEP = 0x15;
const NUL = 0x00;

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) out[at] = text.charCodeAt(at);
  return out;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function region(sizeBytes: number, ...parts: readonly Uint8Array[]): Uint8Array {
  const content = concat(...parts);
  if (content.length > sizeBytes) throw new Error('the fixture does not fit its region');
  const out = new Uint8Array(sizeBytes);
  out.set(content, 0);
  return out;
}

/** `+1` then a duration of `digits` characters, then one text. */
const withDuration = (duration: string, text = 'Apnea'): Uint8Array =>
  concat(
    ascii('+1'),
    Uint8Array.of(SEP),
    ascii(duration),
    Uint8Array.of(MARK),
    ascii(text),
    Uint8Array.of(MARK, NUL),
  );

/** Zero-padded to `length`, so the VALUE is ordinary and only the length is under test. */
const padded = (value: string, length: number): string => value.padStart(length, '0');

describe('a duration field longer than any time needs', () => {
  it('is refused by its length, and the TAL with it', () => {
    const parse = parseTalRegion(region(96, withDuration(padded('30', 41))), 0, 96);
    expect(parse.tals).toHaveLength(0);
    expect(parse.issues).toHaveLength(1);
    const issue = parse.issues[0];
    expect(issue?.code).toBe('TAL_MALFORMED');
    // Says the length, because the value is the one thing a reader cannot see from the message.
    expect(issue?.detail).toContain('the duration field is 41 bytes long');
    expect(issue?.detail).toContain('the TAL was skipped');
    // Not the grammar message: these digits are a perfectly good number, and telling a reader
    // otherwise sends them looking for a defect that is not there.
    expect(issue?.detail).not.toContain('is not 1*DIGIT');
    expect(issue?.detail).not.toContain('never signed');
  });

  it('is refused at the length the onset is refused at, since one bound governs both', () => {
    const longOnset = concat(
      ascii(`+${padded('1', 40)}`),
      Uint8Array.of(MARK),
      ascii('Apnea'),
      Uint8Array.of(MARK, NUL),
    );
    const onset = parseTalRegion(region(96, longOnset), 0, 96);
    const duration = parseTalRegion(region(96, withDuration(padded('30', 41))), 0, 96);
    // 41 bytes either way — `+` and forty digits, or forty-one digits — and both are refused for
    // being long rather than for anything about the number.
    expect(onset.issues[0]?.detail).toContain('bytes long');
    expect(duration.issues[0]?.detail).toContain('bytes long');
  });
});

describe('a duration field at the bound', () => {
  it('is read, so the limit is where the message says it is', () => {
    const parse = parseTalRegion(region(96, withDuration(padded('30', 40))), 0, 96);
    expect(parse.issues.map((one) => one.detail)).toEqual([]);
    expect(parse.tals).toHaveLength(1);
    // Forty leading-zeroed characters of "30": an ordinary thirty-second event.
    expect(parse.tals[0]?.durationTicks).toBe(300_000_000n);
    expect(parse.tals[0]?.onsetTicks).toBe(10_000_000n);
  });
});

describe('the region around a refused TAL', () => {
  it('keeps reading, so one hostile field does not cost the events after it', () => {
    const parse = parseTalRegion(
      region(
        160,
        withDuration(padded('30', 41), 'Hostile'),
        withDuration('5', 'Arousal'),
        withDuration('10', 'Spindle'),
      ),
      0,
      160,
    );
    expect(parse.tals).toHaveLength(2);
    expect(parse.tals.flatMap((tal) => tal.texts.map((one) => one.text))).toEqual([
      'Arousal',
      'Spindle',
    ]);
    // One issue for the one TAL that was dropped, not one per TAL in the region.
    expect(parse.issues).toHaveLength(1);
  });
});
