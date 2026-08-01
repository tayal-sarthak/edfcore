import type { APIRoute } from 'astro';

/**
 * robots.txt, generated so the sitemap URL always matches the deployed origin.
 *
 * edfcore allows everything, deliberately, and that is the opposite of the advice usually
 * given in 2026 ("block training crawlers, allow search crawlers"). That advice is written for
 * publishers protecting content they sell. An open-source library wants the reverse: being
 * present in a model's training data is the single strongest predictor of whether that model
 * later recommends you, so blocking GPTBot or CCBot would be self-harm.
 *
 * The bots are listed by name only as documentation for human readers — every group is
 * `Allow: /`, and the wildcard group already covers them. Naming them costs nothing and saves
 * the next person from having to look up which is which:
 *
 *   Training corpora     GPTBot · ClaudeBot · meta-externalagent · CCBot
 *   Retrieval indexes    OAI-SearchBot · Claude-SearchBot · PerplexityBot
 *   Live, user-triggered ChatGPT-User · Claude-User · Perplexity-User
 *
 * The retrieval and live-fetch bots are the ones that decide whether edfcore can be cited in
 * an answer *today*; the training bots decide whether it is known by heart a year from now.
 * Both matter, so neither is restricted.
 *
 * Google-Extended and Applebot-Extended are deliberately absent: they are control tokens with
 * no crawler behind them, and their only effect is to opt OUT of model training.
 */
export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? new URL('sitemap-index.xml', site).href : undefined;

  const body = [
    '# edfcore — https://github.com/tayal-sarthak/edfcore',
    '#',
    '# Everything is open to every crawler, including AI training crawlers.',
    '# This is an open-source library: being read is the entire point.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    ...(sitemap ? [`Sitemap: ${sitemap}`, ''] : []),
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
