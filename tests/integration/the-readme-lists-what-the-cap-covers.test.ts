/**
 * What `--limit` caps, named in two places that have to agree.
 *
 * `cli-limit-default.test.ts` pins the NUMBER — twenty, and the five places that state it — and
 * `cli-limit-sites.test.ts` pins that every capped site applies the same one. Neither says which
 * KINDS of thing get capped, and that is the half that went stale: 0.6.29 brought `gaps` under
 * the cap and updated the usage text and `cli.md`, while the README kept saying "Diagnostics and
 * events print twenty at a time" (fixed in 0.6.51).
 *
 * A reader of the README then knows the flag exists and believes it does not reach the one
 * command whose output is unbounded by anything but the record count. So the usage text is taken
 * as the source — it is what `--help` prints, and it is beside the code — and the README is
 * checked against it, by the nouns each one lists rather than by a sentence written out twice.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const README = readFileSync(new URL('README.md', ROOT), 'utf8').replace(/\s+/g, ' ');
const CLI_SOURCE = readFileSync(new URL('src/cli-run.ts', ROOT), 'utf8');

/** The nouns in a list like `diagnostics, events or gaps`, lowercased and sorted. */
function kindsIn(list: string): readonly string[] {
  return list
    .split(/,| or | and /)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
    .sort();
}

/** `  --limit <n>   diagnostics, events or gaps to print, default 20` */
const USAGE_KINDS = (() => {
  const match = /^\s*--limit <n>\s+(.+?) to print,/m.exec(CLI_SOURCE);
  if (match?.[1] === undefined) throw new Error('the usage text no longer lists what --limit caps');
  return kindsIn(match[1]);
})();

/** `Diagnostics, events and gaps print twenty at a time` */
const README_KINDS = (() => {
  const match = /\. ([A-Z][a-z]+(?:,[^.]*?)?) print \w+ at a time;/.exec(README);
  if (match?.[1] === undefined) throw new Error('the README no longer lists what the cap covers');
  return kindsIn(match[1]);
})();

describe('the kinds of thing --limit caps', () => {
  it('are three, and the usage text is where they are written down', () => {
    expect(USAGE_KINDS).toEqual(['diagnostics', 'events', 'gaps']);
  });

  it('are the same three the README tells a reader about', () => {
    expect(README_KINDS).toEqual(USAGE_KINDS);
  });

  it('each name a command that is listed as bounded by the flag', () => {
    // `(header, validate, events --list, gaps)` — the commands the usage text scopes it to.
    const scope = /\(header, validate, events --list, gaps\)/.exec(CLI_SOURCE);
    expect(scope).not.toBeNull();
  });
});
