import { getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';

/**
 * A raw-markdown twin of every documentation page, at `/docs/<slug>.md`.
 *
 * Coding agents overwhelmingly prefer markdown when they can find it — one measurement put
 * Claude Code at 76% markdown requests — and the saving is real: markup is roughly 80% of the
 * bytes in a rendered docs page, all of which an agent pays for and then discards.
 *
 * Two things learned from people who measured this, both of which shape the implementation:
 * no AI crawler uses HTTP content negotiation, so serving markdown only on an `Accept` header
 * reaches almost nobody; and the crawlers that *did* find markdown found it through an
 * explicit `<link rel="alternate">` in the HTML. Hence dedicated URLs plus discovery links in
 * the page head, rather than negotiation.
 *
 * This is an ergonomics feature. Nobody has shown that serving markdown improves citation
 * rates, and it should not be justified as if they had.
 */

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');
  return docs.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
};

export const GET: APIRoute = ({ props, site }) => {
  const entry = props.entry as Awaited<ReturnType<typeof getCollection<'docs'>>>[number];
  const canonical = site ? new URL(`docs/${entry.id}`, site).href : `/docs/${entry.id}`;

  // The front matter is rewritten as a short prose header: a self-contained page retrieves
  // better than one whose context lives in a YAML block the extractor may drop.
  const body = [
    `# ${entry.data.title}`,
    '',
    entry.data.lead ?? entry.data.description,
    '',
    `_From the edfcore documentation (${entry.data.section}). Canonical page: ${canonical}_`,
    '',
    '---',
    '',
    entry.body ?? '',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
