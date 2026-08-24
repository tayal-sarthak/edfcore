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
    typecheck: {
      enabled: false,
    },
  },
});
