/**
 * The inspector uploads nothing, which is the most consequential claim on the site.
 *
 * `demo.astro` says a browser can read these files "so a researcher never has to hand a patient
 * recording to a server", and its meta description promises "entirely in your browser, with
 * nothing uploaded". Somebody will drop a real clinical recording on that page on the strength of
 * that sentence.
 *
 * It is a claim about an absence, which is the kind nothing notices breaking. A copy button that
 * reported usage, an error handler that posted a stack trace with a filename in it, an analytics
 * snippet in the shared layout — each is a normal thing to add to a website and each would make
 * the sentence false without changing anything a visitor can see.
 *
 * So it is checked as an absence, across every page and component the site ships rather than the
 * demo alone: the promise is about the page a visitor is on, and the layout wraps it.
 *
 * `navigator.clipboard` is the one `navigator` use in the tree and is deliberately not treated as
 * a network primitive — it moves text the visitor asked to copy into their own clipboard, and it
 * is in `CodeBlock.astro`, which the demo does not use for file data. The allowance is named
 * rather than a wildcard, so `navigator.sendBeacon` is still a failure.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

/** Every source file the site ships to a browser. */
const SITE_FILES: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(new URL(`${relative}/`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // `content/docs` is prose; the endpoints under `pages/` are build-time and included.
        if (entry.name === 'content') continue;
        walk(`${relative}/${entry.name}`);
      } else if (/\.(astro|ts|js)$/.test(entry.name)) {
        found.push(`${relative}/${entry.name}`);
      }
    }
  };
  walk('website/src');
  return found;
})();

/**
 * Ways a browser sends bytes somewhere.
 *
 * `navigator.clipboard` is excluded by name rather than by allowing `navigator.` generally, so
 * `navigator.sendBeacon` — the primitive built for exactly the thing this forbids — still counts.
 */
const NETWORK = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bsendBeacon\b/,
  /\bnew\s+WebSocket\b/,
  /\bEventSource\b/,
  /\bnavigator\.(?!clipboard)/,
  /<form\b/,
  /\bimport\s*\(\s*['"]https?:/,
];

/** Comments stripped, so a docblock describing the ban is not the ban's first violation. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the promise the demo page makes', () => {
  it('is still written on the page', () => {
    const demo = read('website/src/pages/demo.astro').replace(/\s+/g, ' ');
    expect(demo).toContain('entirely in your browser, with nothing uploaded');
    expect(demo).toContain('never has to hand a patient recording to a server');
  });

  it('found the site sources, so a passing run is not a vacuous one', () => {
    expect(SITE_FILES.length).toBeGreaterThan(8);
    expect(SITE_FILES).toContain('website/src/pages/demo.astro');
    // The layout wraps every page, so it is part of what the promise covers.
    expect(SITE_FILES).toContain('website/src/layouts/Base.astro');
  });
});

describe('nothing the site ships can send bytes anywhere', () => {
  for (const pattern of NETWORK) {
    it(`uses no ${String(pattern)}`, () => {
      const offenders = SITE_FILES.filter((file) => pattern.test(codeOf(read(file))));
      expect(offenders).toEqual([]);
    });
  }

  it('allows the clipboard by name rather than allowing navigator generally', () => {
    // The one `navigator` in the tree: it moves text the visitor asked to copy into their own
    // clipboard, and never touches file data.
    const copy = read('website/src/components/CodeBlock.astro');
    expect(copy).toContain('navigator.clipboard.writeText');
    // And the pattern that permits it still rejects the primitive built for beaconing.
    const beacon = NETWORK.find((entry) => entry.source.includes('navigator'));
    expect(beacon?.test('navigator.sendBeacon(url, data)')).toBe(true);
    expect(beacon?.test('navigator.clipboard.writeText(code)')).toBe(false);
  });

  it('reads the dropped file through the package rather than posting it', () => {
    // The positive half: the page opens the file with edfcore's own browser adapter, which takes
    // a `Blob` and never leaves the tab.
    const demo = read('website/src/pages/demo.astro');
    expect(demo).toContain('blobSource');
    expect(demo).toContain('openEdf');
  });
});
