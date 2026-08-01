import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

/**
 * The canonical origin.
 *
 * Vercel exposes the production domain as an environment variable, so a linked repo gets the
 * right absolute URLs in the sitemap without anyone editing this file. `SITE_URL` overrides it
 * for a custom domain; the localhost fallback keeps `astro dev` working.
 */
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:4321');

export default defineConfig({
  site,
  trailingSlash: 'never',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      /*
       * One theme, and code blocks stay dark on both grounds — see the `.astro-code` rules
       * in src/styles/tokens.css. This is a design decision rather than a limitation: the
       * page's world is an instrument in a dark room, and the instrument's display does not
       * turn to paper when the room lights come on. It also means the syntax palette is
       * chosen once against one known surface instead of being re-derived per theme.
       *
       * Vesper is deliberately quiet — near-monochrome with a warm cast, which sits under
       * the page's amber rather than competing with it.
       */
      theme: 'vesper',
      wrap: false,
    },
  },
  devToolbar: { enabled: false },
  redirects: {
    '/docs': '/docs/quick-start',
  },
});
