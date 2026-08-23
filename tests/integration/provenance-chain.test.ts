/**
 * Every version is signed, and the four lines that make that true.
 *
 * `scripts/release.mjs` ends a successful run by telling whoever cut it that the version "is on
 * npm with a provenance attestation". It prints that sentence unconditionally. Nothing verifies
 * that the workflow still signs anything, and nothing could notice if it stopped: npm accepts an
 * unsigned publish exactly as it accepts a signed one, the version appears, the tag resolves, and
 * the only difference is a panel missing from a web page nobody reloads.
 *
 * The attestation is not decoration here. `AGENTS.md` explains that the
 * `archive/pre-squash-2026-08-16` branch is load-bearing precisely because "every version
 * published on 2026-08-16 carries a signed npm provenance attestation naming the commit it was
 * built from" — a whole branch is kept alive so those Source Commit links keep resolving. A run of
 * unsigned versions would make that reasoning apply to a shrinking fraction of the package.
 *
 * Four things have to hold together, and each is a line a tidy-up would remove without a thought:
 *
 *  - `id-token: write`, which is where the signing key comes from. Removing it looks like
 *    tightening permissions, which is normally the right instinct.
 *  - `--provenance` on the publish step. It looks redundant next to `publishConfig`.
 *  - `--provenance` NOT in `publishConfig`, which is the opposite tidy-up and the one with a
 *    reason written beside it: there it would apply to every publish, and a laptop has no OIDC
 *    token to sign with, so an ordinary `npm publish` would fail with no useful explanation.
 *  - `registry-url` on `setup-node`, which is what writes the `.npmrc` that reads
 *    `NODE_AUTH_TOKEN`. Without it the publish is unauthenticated and never gets far enough to
 *    sign anything.
 *
 * `release-model.test.ts` pins what TRIGGERS the workflow. This is what the workflow does once it
 * is triggered.
 *
 * What this does NOT check: that npm actually produced an attestation. That needs the registry,
 * and the suite is offline. This is a check that the repository still asks for one.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const PUBLISH = read('.github/workflows/publish.yml');
const RELEASE = read('scripts/release.mjs');
const MANIFEST = JSON.parse(read('package.json')) as {
  publishConfig?: Record<string, unknown>;
};

/** The workflow with its comments stripped, so a mention in prose cannot stand for a setting. */
const SETTINGS = PUBLISH.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('the sentence the release script prints', () => {
  it('is still printed, and still claims an attestation', () => {
    expect(RELEASE).toContain('is on npm with a provenance attestation');
  });

  it('is a claim about the workflow, which is what the rest of this file checks', () => {
    // Named so the connection is not left to a reader: this sentence is the thing that goes
    // stale when the workflow stops signing, and it is printed by the script that cut the tag.
    expect(SETTINGS).toContain('--provenance');
  });
});

describe('the four lines behind it', () => {
  it('grants the token the signature is made with', () => {
    expect(SETTINGS).toMatch(/permissions:[\s\S]*?id-token:\s*write/);
  });

  it('passes --provenance on the publish itself', () => {
    expect(SETTINGS).toMatch(/run:\s*npm publish[^\n]*--provenance/);
  });

  it('passes --access public there too, matching the manifest', () => {
    expect(MANIFEST.publishConfig?.access).toBe('public');
    expect(SETTINGS).toMatch(/run:\s*npm publish[^\n]*--access public/);
  });

  it('keeps --provenance out of publishConfig, so a hand publish still works', () => {
    // The opposite tidy-up, and the one with a reason: in publishConfig it applies to every
    // publish, including one run from a laptop, which has no OIDC token to sign with.
    expect(MANIFEST.publishConfig?.provenance).toBeUndefined();
    expect(read('package.json')).not.toContain('"provenance"');
  });

  it('configures the registry, which is what makes the token readable', () => {
    expect(SETTINGS).toContain('registry-url: https://registry.npmjs.org');
    expect(SETTINGS).toMatch(/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  });
});

describe('the reasons, which are the only thing stopping the tidy-up', () => {
  /** The comments as sentences: the `#` markers go before the wrapping is collapsed. */
  const prose = PUBLISH.split('\n')
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

  it('still say why the flag is on the step rather than in publishConfig', () => {
    expect(prose).toContain('--provenance lives here rather than in publishConfig on purpose');
    expect(prose).toContain('a laptop has no OIDC token');
  });

  it('still say what the id-token permission is for', () => {
    expect(prose).toContain('Required for the provenance attestation');
  });

  it('still say that provenance is independent of how the publish authenticates', () => {
    // Otherwise the next person to look at the NPM_TOKEN secret concludes the token is what
    // signs, and removing `id-token: write` looks free.
    expect(prose).toContain('Provenance is independent of how the publish authenticates');
  });
});

describe('and the branch that is kept alive for those signatures', () => {
  it('is still explained by the attestations, not by the commits alone', () => {
    const agents = read('AGENTS.md').replace(/\s+/g, ' ');
    expect(agents).toContain('signed npm provenance attestation naming the commit it was built');
    expect(agents).toContain('archive/pre-squash-2026-08-16');
  });
});
