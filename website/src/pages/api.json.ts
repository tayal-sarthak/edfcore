import type { APIRoute } from 'astro';
import * as universal from 'edfcore';
import * as nodeEntry from 'edfcore/node';
import * as validateEntry from 'edfcore/validate';

/**
 * `/api.json` — the size of the public surface, counted rather than written down.
 *
 * This exists to back the README's shields.io badge. A badge reading a number a human typed is
 * the site footer that said "Version 0.1.0" through three minor series: correct on the day it
 * was written and silently wrong afterwards. So the counts come from importing the three entry
 * points the package actually publishes, at build time, from the same `dist` that ships.
 *
 * Runtime exports only. Types are erased before this file can see them, and counting them would
 * mean parsing source that is not this project's to parse from here — `api-surface.test.ts` does
 * that, against the barrels themselves.
 */
export const GET: APIRoute = () => {
  const entries = {
    edfcore: Object.keys(universal).length,
    'edfcore/node': Object.keys(nodeEntry).length,
    'edfcore/validate': Object.keys(validateEntry).length,
  } as const;

  const body = {
    version: universal.VERSION,
    entryPoints: Object.keys(entries).length,
    exports: {
      ...entries,
      total: Object.values(entries).reduce((sum, count) => sum + count, 0),
    },
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
