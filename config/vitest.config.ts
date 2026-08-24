import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test-d.ts'],
    /*
     * `tests/scratch/` is gitignored, and that was not enough.
     *
     * It holds throwaway reproductions written while chasing a defect. They assert whatever
     * behaviour was current when they were written, so committing one would pin a defect — which
     * is why .gitignore excludes it. But an uncommitted probe still ran: it was inside the
     * `tests/**` glob and inside the tsconfig `include`, so a leftover file joined the suite and
     * the typecheck, and `npm run check` — which the release script runs before tagging — failed
     * or passed on the strength of a file nobody meant to keep.
     *
     * Excluded here and in tsconfig.json. vitest applies `exclude` even to an explicit filename
     * filter, so a probe is run through `npm run test:scratch`, which uses a config of its own.
     */
    exclude: [...configDefaults.exclude, 'tests/scratch/**'],
    environment: 'node',
    /*
     * Arms the network trap once per test file, before anything in it runs. `tests/README.md`
     * claims the suite is offline; `tests/support/offline.ts` is what makes that a property
     * rather than a description, and `tests/integration/offline.test.ts` proves it is loaded.
     *
     * Not applied to `vitest.scratch.config.ts`: a throwaway probe reproducing a defect against
     * a real server is a legitimate thing to write, and that config exists for exactly the runs
     * this suite's rules do not govern.
     */
    setupFiles: ['tests/support/offline.ts'],
    /*
     * A hang detector, not a performance budget.
     *
     * vitest's default is five seconds, which nobody here chose, and no test in this suite uses
     * the clock as an assertion — the cost tests (`open-cost`, `read-header-cost`, `sweep-cost`)
     * count READS and BYTES, which is what makes them stable. So the only thing a timeout does
     * here is stop an infinite loop from taking the run with it.
     *
     * Five seconds is too tight for that job. Several tests build multi-megabyte fixtures and the
     * heaviest ordinary case runs in about a second, so the default left under six times its own
     * cost as headroom — and a run under `--coverage` is several times slower than one without,
     * which is where the failures actually appeared: two in `read-pattern.test.ts` and one in
     * `envelope.test.ts`, all three passing on the same commit without instrumentation. A timeout
     * that fires on correct work teaches the reader to rerun rather than to read.
     *
     * Thirty seconds is thirty times the slowest ordinary test and still fails a genuine hang well
     * inside a minute. The files that need longer still say so themselves — `spec-references`
     * takes 60 s for one sweep, `read-pattern` 120 s to build its fixtures, and
     * `extreme-geometry` 300 s explicitly as a hang detector for a file designed to provoke one.
     */
    testTimeout: 30_000,
    typecheck: {
      enabled: false,
    },
  },
});
