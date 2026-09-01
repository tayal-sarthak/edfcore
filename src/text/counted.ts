/**
 * A number and the noun it counts.
 *
 * Layer 1. Imports nothing.
 *
 * Every line edfcore prints that leads with a count needs the same two characters decided, and
 * before this the package decided them three different ways. `formatValidationReport` had a
 * private `pluralise` and used it; `formatHeader` interpolated the noun raw, so the first line of
 * `edfcore header` read `EDF · 1 signals · 6 records` on a one-signal file and the diagnostic
 * summary under it read `2 warning`; and thirteen other lines wrote `1 gap(s)`, which is right
 * but is a third convention. Two commands over one file disagreed about the same number — `validate` said
 * "scanned 1 record" while `header` said "1 records", eight lines apart in the same terminal.
 *
 * 0.4.421 fixed exactly this inside `formatValidationReport` and named the reason: one function,
 * two conventions, and the ungrammatical one on the line a reader sees first. The fix was a
 * private helper, so the other five sites kept their own answer. This is that helper, one layer
 * down, where every printer can reach it.
 *
 * English only, and deliberately: edfcore emits no localised text anywhere, `formatDiagnostics`
 * states that its output is deterministic and free of locale-sensitive formatting, and a plural
 * rule that consulted a locale would be the first thing to break it.
 */

/**
 * The noun alone, agreeing with a count that is printed separately.
 *
 * Two lines of `formatValidationReport` group their number — `read 1,048,576 bytes` — so they
 * cannot hand the count to `pluralise` and get the grouping back. Splitting the rule in two is
 * what keeps those lines on the same rule as the rest rather than spelling it out again beside a
 * `toLocaleString`.
 */
export function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

/** `1 record`, `2 records`. The noun is written singular; only a regular `s` is added. */
export function pluralise(count: number, noun: string): string {
  return `${count} ${plural(noun, count)}`;
}
