import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

/**
 * `/llms.txt`, per the proposal at https://llmstxt.org.
 *
 * An honest note on why this exists, because the evidence is not flattering: a June 2026 study
 * of 137,210 domains found 97% of published llms.txt files received zero requests in a month,
 * and no AI crawler ever probes for the file on domains that lack it. It is not a search or
 * retrieval signal, and nothing here should be justified as one.
 *
 * It is worth shipping anyway for one specific reason: the biggest measured consumer of these
 * files is agentic coding clients rather than search bots. edfcore's users are developers
 * sitting in exactly those tools, and an agent that has already been pointed at this domain
 * gets a cheap, accurate map instead of scraping HTML. That is ergonomics for a real audience,
 * not visibility, and it costs one endpoint to provide.
 */

const SECTIONS = ['Start here', 'Guides', 'Reference', 'Background'] as const;

export const GET: APIRoute = async ({ site }) => {
  const origin = site ?? new URL('http://localhost:4321');
  const pages = await getCollection('docs');
  const url = (slug: string) => new URL(`docs/${slug}`, origin).href;

  const grouped = SECTIONS.map((section) => ({
    section,
    entries: pages
      .filter((page) => page.data.section === section)
      .sort((a, b) => a.data.order - b.data.order),
  })).filter((group) => group.entries.length > 0);

  const body = [
    '# edfcore',
    '',
    '> A zero-dependency TypeScript library for reading EDF, EDF+, BDF and BDF+ biosignal',
    '> files — EEG, sleep studies, ECG, EMG — in browsers and in Node. It does true random',
    '> access into multi-hour recordings, exposes exact event times as bigint ticks, and',
    '> reports malformed files as typed errors that name the offending byte rather than',
    '> returning plausible-looking wrong numbers.',
    '',
    'Read-only. No AI, no analysis, no filtering, no resampling — it is a file-format library.',
    'Install with `npm install edfcore`. Requires Node 22.12+, or Chrome 94+/Firefox 93+/Safari',
    '15.4+ in the browser. Three entry points: `edfcore` (universal), `edfcore/node` (filesystem',
    'adapters), `edfcore/validate` (conformance checking).',
    '',
    'Every page below is also available as raw markdown by appending `.md` to its URL.',
    '',
    ...grouped.flatMap((group) => [
      `## ${group.section}`,
      '',
      ...group.entries.map(
        (page) => `- [${page.data.title}](${url(page.id)}): ${page.data.description}`,
      ),
      '',
    ]),
    '## Optional',
    '',
    `- [Live inspector](${new URL('demo', origin).href}): opens an EDF file and shows its header, channels, events and waveforms entirely in the browser.`,
    `- [Full documentation as one file](${new URL('llms-full.txt', origin).href}): every page above concatenated.`,
    '- [Source](https://github.com/tayal-sarthak/edfcore): implementation, tests, and the design decision record.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
