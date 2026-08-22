/**
 * The palette has one definition, and four files copy from it by hand.
 *
 * `tokens.css` opens by explaining the pairing: the signal green carries the trace, the rose is
 * SEMANTIC and marks events, and rose was chosen over red because red-on-green is the one pairing
 * red-green colourblindness collapses — with the measured separation written down. That reasoning
 * is worth something only while the colours it describes are the colours a visitor sees.
 *
 * Three places cannot say `var(--signal)` and so restate the value:
 *
 *  - `og.svg`, because an SVG exported by `qlmanage` has no stylesheet. Nine literal hexes.
 *  - The two `theme-color` metas in `Base.astro`, because the browser paints the chrome around
 *    the page before any CSS arrives. Wrong values put a stale ground behind a scrolling page,
 *    on phones, where nobody developing the site is looking.
 *  - `TraceStrip.astro`, which draws to a canvas. It reads the tokens at runtime — the right
 *    thing, and why the theme toggle drives the animation — but its fallbacks are the palette
 *    written a third way, in decimal RGB, which is the copy least likely to be recognised as one
 *    when the palette is retuned.
 *
 * So every literal colour outside `tokens.css` is required to be a token from `tokens.css`, and
 * the ones with a specific job are required to be the specific token that does it. Retuning the
 * palette then fails here rather than shipping a card and a browser chrome in last season's
 * colours.
 *
 * What this does NOT check: that `og.png` was re-exported after a change to `og.svg`. Nothing
 * here can render SVG — see `share-card.test.ts`, which checks the dimensions instead.
 *
 * Nor the one literal in `TraceStrip.astro` that is not a copy of anything: the beam head's core
 * is a near-white green brighter than any token, because a phosphor blowout is additive light and
 * there is no palette entry for it. Only the FALLBACKS are checked, which is the claim.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const TOKENS = read('website/src/styles/tokens.css');
const BASE = read('website/src/layouts/Base.astro');
const SVG = read('website/design/og.svg');
const TRACE = read('website/src/components/TraceStrip.astro');

/** The declarations of one `:root { … }` block, as written. */
const declarations = (block: string): ReadonlyMap<string, string> =>
  new Map(
    [...block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1] as string,
      (match[2] as string).trim(),
    ]),
  );

/**
 * The default world, and the light theme layered over it, in cascade order.
 *
 * Braces are counted rather than matched against an indent: the light `:root` is nested inside a
 * media query, so "the next line that is a closing brace" finds a different block depending on
 * which of the two is being read.
 */
const scope = (from: number): string => {
  const open = TOKENS.indexOf('{', TOKENS.indexOf(':root', from));
  let depth = 0;
  for (let at = open; at < TOKENS.length; at += 1) {
    if (TOKENS[at] === '{') depth += 1;
    else if (TOKENS[at] === '}') {
      depth -= 1;
      if (depth === 0) return TOKENS.slice(open + 1, at);
    }
  }
  throw new Error('unclosed :root block in tokens.css');
};
const DARK = declarations(scope(0));
const LIGHT = declarations(scope(TOKENS.indexOf('@media (prefers-color-scheme: light)')));

/** Follow `var(--x)` to the literal behind it, the way the cascade does. */
const resolve = (name: string, layer: ReadonlyMap<string, string>): string | undefined => {
  let value = layer.get(name) ?? DARK.get(name);
  for (let hop = 0; hop < 4 && value !== undefined; hop += 1) {
    const indirect = /^var\((--[\w-]+)\)$/.exec(value);
    if (indirect === null) return value.toLowerCase();
    value = layer.get(indirect[1] as string) ?? DARK.get(indirect[1] as string);
  }
  return value?.toLowerCase();
};

/** Every literal colour the palette defines, hex → the names that carry it. */
const BY_HEX: ReadonlyMap<string, readonly string[]> = (() => {
  const found = new Map<string, string[]>();
  for (const [name, value] of DARK) {
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      const hex = value.toLowerCase();
      found.set(hex, [...(found.get(hex) ?? []), name]);
    }
  }
  return found;
})();

const rgb = (hex: string): readonly number[] =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

describe('the palette was read', () => {
  it('resolved both layers, so a passing run is not a vacuous one', () => {
    expect(BY_HEX.size).toBeGreaterThan(15);
    expect(LIGHT.size).toBeGreaterThan(10);
    // A one-hop indirection and a two-hop one, both resolved.
    expect(resolve('--bg', DARK)).toBe(resolve('--ink-900', DARK));
    expect(resolve('--accent', DARK)).toBe(resolve('--signal', DARK));
    // And the layers really are different, or the light assertions below prove nothing.
    expect(resolve('--bg', LIGHT)).not.toBe(resolve('--bg', DARK));
  });
});

describe('the browser chrome', () => {
  const themeColour = (scheme: string): string | undefined =>
    new RegExp(
      `<meta name="theme-color" media="\\(prefers-color-scheme: ${scheme}\\)" content="(#[0-9a-f]{6})"`,
    )
      .exec(BASE)?.[1]
      ?.toLowerCase();

  it('is painted the ground the page is about to paint', () => {
    // Not merely "a token": the ground, resolved through `--bg` in each layer. Anything else is
    // a band of the wrong colour above and below a scrolling page.
    expect(themeColour('dark')).toBe(resolve('--bg', DARK));
    expect(themeColour('light')).toBe(resolve('--bg', LIGHT));
  });

  it('is the only literal colour in the whole component tree', () => {
    // Which is why these two are checked and nothing else has to be: everything else says
    // `var(--…)`, and this is what keeps that true.
    const literals = [
      'pages/404.astro',
      'pages/demo.astro',
      'pages/index.astro',
      'layouts/Base.astro',
    ]
      .flatMap((file) =>
        [...read(`website/src/${file}`).matchAll(/#[0-9a-f]{3,6}\b/gi)].map(
          (match) => `${file}: ${match[0]}`,
        ),
      )
      .filter((found) => !found.startsWith('layouts/Base.astro'));
    expect(literals, 'a colour written out instead of a token').toEqual([]);
  });
});

describe('the share card', () => {
  const CARD = [
    ...new Set([...SVG.matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].toLowerCase())),
  ];

  it('paints every stroke with a token from the palette', () => {
    expect(CARD.length).toBeGreaterThan(5);
    const strays = CARD.filter((hex) => !BY_HEX.has(hex));
    expect(strays, 'a colour on the card that the palette does not define').toEqual([]);
  });

  it('grounds itself in the dark world, and marks its event in the rose', () => {
    // The card is one image for both themes, so it is the dark palette or nothing.
    expect(CARD).toContain(resolve('--ink-900', DARK));
    // Rose is semantic. On the card it is on the annotation and its leader line, which is the
    // rule `tokens.css` states rather than a coincidence of taste.
    const rose = resolve('--mark', DARK) as string;
    expect(SVG).toContain(`stroke="${rose}"`);
    expect(SVG).toContain(`fill="${rose}">Sleep stage`);
  });
});

describe('the canvas fallbacks', () => {
  /**
   * Every `hexToRgb(getPropertyValue('--x'), fallback)` in the component, as the token it reads
   * and the triple it draws with when that token is missing. A fallback written inline is taken
   * as written; one written as an identifier is followed to its `let name: Rgb = { … }`.
   */
  const FALLBACKS: ReadonlyArray<readonly [string, string]> = [
    ...TRACE.matchAll(/hexToRgb\(s\.getPropertyValue\('(--[\w-]+)'\),\s*([^)]+)\)/g),
  ].map((match) => {
    const written = match[2] as string;
    const literal = /\{\s*r:\s*(\d+),\s*g:\s*(\d+),\s*b:\s*(\d+)\s*\}/.exec(
      written.trim().startsWith('{')
        ? written
        : (new RegExp(`let ${written.trim()}: Rgb = (\\{[^}]+\\})`).exec(TRACE)?.[1] ?? ''),
    );
    return [match[1] as string, [1, 2, 3].map((at) => Number(literal?.[at])).join(',')] as const;
  });

  it('were found and followed, so a passing run is not a vacuous one', () => {
    expect(FALLBACKS.length).toBeGreaterThan(2);
    // One inline and one followed through an identifier: both shapes really resolved.
    expect(FALLBACKS.every(([, triple]) => /^\d+,\d+,\d+$/.test(triple))).toBe(true);
    expect(FALLBACKS.map(([token]) => token)).toContain('--bg');
  });

  it('draws the token it is standing in for', () => {
    // `readTokens()` overwrites these from the live stylesheet, so they are what draws only when a
    // token is missing — and then the honest thing to draw is that token's default-theme value.
    const wrong = FALLBACKS.filter(
      ([token, triple]) => rgb(resolve(token, DARK) as string).join(',') !== triple,
    ).map(([token, triple]) => `${token} falls back to ${triple}, not ${resolve(token, DARK)}`);
    expect(wrong, 'a canvas fallback that is not its own token').toEqual([]);
  });

  it('takes the dark values, which is the world the page defaults to', () => {
    // Named rather than implied: `--accent` and `--event` both differ between the layers, so
    // "matches a token" would be satisfied by the light one.
    for (const token of ['--accent', '--event']) {
      expect(resolve(token, LIGHT), `${token} no longer differs by theme`).not.toBe(
        resolve(token, DARK),
      );
      const fallback = FALLBACKS.find(([name]) => name === token);
      expect(fallback?.[1]).toBe(rgb(resolve(token, DARK) as string).join(','));
    }
  });
});
