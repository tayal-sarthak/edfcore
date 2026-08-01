import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Documentation pages.
 *
 * `section` groups pages in the sidebar; `order` sorts within a section. Both are required so
 * a new page cannot silently land at the bottom of the wrong group.
 */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(['Start here', 'Guides', 'Reference', 'Background']),
    order: z.number(),
    /** Shown under the page title when the page needs a longer lead-in than the description. */
    lead: z.string().optional(),
  }),
});

export const collections = { docs };
