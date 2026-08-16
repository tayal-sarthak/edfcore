/**
 * An ES module that Node cannot `require()`, used to prove the check that says edfcore can.
 *
 * `require-from-commonjs.test.ts` asserts that requiring the built bundles succeeds. On its own
 * that assertion is only as good as the harness: a child process that quietly did nothing would
 * pass it. This file is the negative control — one top-level `await` is the whole point of it —
 * so the same harness is shown failing with `ERR_REQUIRE_ASYNC_MODULE` on something that should
 * fail, in the same run.
 *
 * Nothing imports it. It exists to be required and to be refused.
 */

export const resolved = await Promise.resolve('this module has a top-level await');
