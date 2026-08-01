import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

/**
 * `/llms-full.txt` — every documentation page concatenated as one markdown file.
 *
 * Note that this filename is a de-facto convention popularised by documentation hosts, not
 * part of the llms.txt proposal itself, which describes tool-generated `llms-ctx.txt` files
 * instead. It is included because it is what agents and humans actually look for.
 *
 * The point is token economics: an agent that needs the whole picture can take one request
 * of clean markdown instead of twenty HTML fetches whose markup it has to discard.
 */

const SECTIONS = ['Start here', 'Guides', 'Reference', 'Background'] as const;

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL('http://localhost:4321');
  const pages = await getCollection('docs');

  const ordered = SECTIONS.flatMap((section) =>
    pages
      .filter((page) => page.data.section === section)
      .sort((a, b) => a.data.order - b.data.order)
      .map((page) => ({ page, section })),
  );

  const body = [
    '# edfcore — complete documentation',
    '',
    'A zero-dependency TypeScript library for reading EDF, EDF+, BDF and BDF+ biosignal files',
    'in browsers and in Node. Source: https://github.com/tayal-sarthak/edfcore',
    '',
    'Every section below is one page of the documentation site, in reading order.',
    '',
    ...ordered.flatMap(({ page, section }) => [
      '---',
      '',
      `# ${page.data.title}`,
      '',
      `Section: ${section}`,
      `Source: ${new URL(`docs/${page.id}`, origin).href}`,
      '',
      page.data.description,
      '',
      page.body ?? '',
      '',
    ]),
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
