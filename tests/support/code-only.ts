/**
 * A source file with its comments and string literals removed.
 *
 * Written for the checks that ask "does this module USE X", where the answer must not be changed
 * by a module that merely talks about X. Both bans in `AGENTS.md` have that shape and both have
 * a file that documents them: `header/fields.ts` carries the word `TextDecoder` inside a
 * diagnostic message explaining why edfcore does not use one, and a comments-only sweep reads
 * that as the violation rather than as the explanation (0.4.275).
 *
 * `//` is spared when preceded by `:` so a URL in a comment does not truncate the line. The three
 * string forms handle escapes, which is all this codebase needs — a single-quoted literal here
 * never nests, and a template's `${…}` may contain code but no reference this is looking for.
 */
export function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`(?:[^`\\]|\\.)*`/g, "''")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, "''");
}
