#!/usr/bin/env node

/**
 * The generated endpoints say what the collection says.
 *
 * `llms.txt`, `llms-full.txt`, the `.md` twin of every page, `robots.txt` and the JSON the badge
 * reads are built, not written, and nothing checked what came out. They are also the half of the site
 * `npm run check` cannot reach: the generators live under `website/`, where importing them drags
 * in a tsconfig the CI check does not install, so this runs in the job that already builds the
 * site rather than in the test suite.
 *
 * Each of these fails silently. A page missing from `llms.txt` is a page an agent never learns
 * about; a `.md` twin that did not render leaves a documented URL returning a 404 while the HTML
 * page beside it is fine; a `sitemap` line naming a file the build did not emit tells a crawler to
 * fetch nothing.
 *
 *   node scripts/check-site-output.mjs
 *
 * Reads `website/dist/`, so `npm --prefix website run build` has to have run.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'website', 'dist');
const PAGES_DIR = join(ROOT, 'website', 'src', 'content', 'docs');

const failures = [];
const fail = (message) => failures.push(message);
const read = (relative) => readFileSync(join(DIST, relative), 'utf8');

if (!existsSync(DIST)) {
  console.error(
    '\n  website/dist is missing, so there is nothing to check.\n' +
      '  Next: run `npm --prefix website run build` first.\n',
  );
  process.exit(1);
}

const slugs = readdirSync(PAGES_DIR)
  .filter((name) => /\.mdx?$/.test(name))
  .map((name) => name.replace(/\.mdx?$/, ''));

if (slugs.length < 15) fail(`only ${slugs.length} pages found in ${PAGES_DIR}`);

// --- every page is in the map an agent is handed --------------------------

const llms = read('llms.txt');
for (const slug of slugs) {
  if (!llms.includes(`/docs/${slug}`)) fail(`llms.txt does not list /docs/${slug}`);
}

// --- and its text is in the one-file version ------------------------------

const full = read('llms-full.txt');
for (const slug of slugs) {
  if (!full.includes(`/docs/${slug}`)) fail(`llms-full.txt does not include /docs/${slug}`);
}
if (full.length < 100_000) fail(`llms-full.txt is ${full.length} bytes, which is too small`);

// --- the markdown twin llms.txt promises ----------------------------------
//
// "Every page below is also available as raw markdown by appending `.md` to its URL."

for (const slug of slugs) {
  const twin = join(DIST, 'docs', `${slug}.md`);
  if (!existsSync(twin)) {
    fail(`/docs/${slug}.md was not emitted, and llms.txt promises it`);
    continue;
  }
  const text = readFileSync(twin, 'utf8');
  if (text.length < 200) fail(`/docs/${slug}.md is ${text.length} bytes, so it rendered empty`);
  if (!text.includes('Canonical page:')) fail(`/docs/${slug}.md has no canonical link`);
}

// --- robots names a sitemap the build emitted -----------------------------

const robots = read('robots.txt');
const sitemap = /Sitemap:\s*\S*?\/([\w.-]+)$/m.exec(robots);
if (sitemap === null) fail('robots.txt names no sitemap');
else if (!existsSync(join(DIST, sitemap[1])))
  fail(`robots.txt names ${sitemap[1]}, which is not in the build`);

// --- the badge endpoint is the shape the README queries --------------------

const api = JSON.parse(read('api.json'));
if (typeof api?.exports?.total !== 'number')
  fail('the badge endpoint has no numeric exports.total');
if (api?.version !== JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version) {
  fail(`the badge endpoint reports version ${api?.version}, not the package's`);
}

// --- every page carries the head the layout promises ----------------------
//
// `Base.astro` builds the head once for every page, which is exactly why a page that misses it
// misses it silently: nothing renders differently. The `rel="alternate"` link is the one with a
// stated purpose — `[...slug].md.ts` records that no AI crawler uses content negotiation and the
// ones that found markdown found it through that tag, so a docs page without it has a markdown
// twin nothing can discover.
//
// The redirect stub Astro generates for `/docs` is exempt, and correctly so: it carries
// `robots: noindex` and exists to be followed rather than read.

const htmlPages = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.html')) htmlPages.push(path);
  }
})(DIST);

if (htmlPages.length < slugs.length) fail(`only ${htmlPages.length} HTML pages were built`);

for (const path of htmlPages) {
  const html = readFileSync(path, 'utf8');
  const where = path.slice(DIST.length + 1);
  if (html.includes('name="robots" content="noindex"')) continue;

  for (const tag of ['<title>', 'name="description"', 'rel="canonical"', 'og:title', 'og:image']) {
    if (!html.includes(tag)) fail(`${where} has no ${tag} in its head`);
  }
  if (where.startsWith('docs/') && !html.includes('type="text/markdown"')) {
    fail(`${where} has no rel="alternate" markdown link, so its .md twin is undiscoverable`);
  }
}

// --- report ----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n  ${failures.length} problem(s) in the built site:\n`);
  for (const message of failures) console.error(`    ${message}`);
  console.error('');
  process.exit(1);
}

console.log(
  `  Site output checked: ${slugs.length} pages, their markdown twins, ` +
    `${htmlPages.length} rendered heads, and 4 endpoints.`,
);
