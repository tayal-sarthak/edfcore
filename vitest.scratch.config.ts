import { defineConfig } from 'vitest/config';

/**
 * Runs the throwaway reproductions under `tests/scratch/`, and nothing else.
 *
 * The main config excludes that directory so a leftover probe can never join the suite or the
 * typecheck — `npm run check` is what `scripts/release.mjs` runs before it tags, and a release
 * must not turn on a file nobody meant to keep. But vitest applies `exclude` even to an explicit
 * filename filter, so excluding it also made a probe unrunnable, which is not the goal.
 *
 *   npm run test:scratch                       every probe
 *   npm run test:scratch -- tests/scratch/x.test.ts     one of them
 *
 * Probes are never committed: they assert whatever behaviour was current when they were written,
 * so keeping one would pin a defect. A finding worth keeping becomes a real test somewhere in
 * `tests/`, against the behaviour that is correct rather than the behaviour that was there.
 */
export default defineConfig({
  test: {
    include: ['tests/scratch/**/*.test.ts'],
    environment: 'node',
    typecheck: { enabled: false },
  },
});
