/**
 * The README's status line still names the series this package publishes.
 *
 * That line is the first thing a reader sees on npm. It said "Status: 0.1.x, early" through
 * fifty-one releases and two minor versions, so the front page of the package announced a series
 * nobody could install (fixed in 0.3.53).
 *
 * Checked against `package.json`, which moves on its own every release. A claim nothing checks is
 * a claim that goes stale silently, which is the entire failure mode here.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const README = read('../../README.md');
const VERSION = (JSON.parse(read('../../package.json')) as { version: string }).version;

/** The `**Status: X.Y.x, ...**` line. */
const STATUS = /\*\*Status: (\d+)\.(\d+)\.x/.exec(README);

describe('the README status line', () => {
  it('is present and parses', () => {
    // Without this, the assertion below would be vacuously true if the line were reworded away.
    expect(STATUS).not.toBeNull();
  });

  it('names the series this package actually publishes', () => {
    const [major, minor] = VERSION.split('.');
    expect(STATUS?.[1]).toBe(major);
    expect(STATUS?.[2]).toBe(minor);
  });
});
