/**
 * The type names a barrel exports, read as text.
 *
 * Shared because it existed twice and the copies were not equal. `api-surface.test.ts` counts these
 * against the README's total; `docs-coverage.test.ts` checks each one is mentioned in the docs.
 * Both read only `export type { … } from` blocks, so neither saw `FileHandleLike` — `node.ts`
 * declares that one and exports it in place — and the README undercounted public types from the
 * first commit until 0.4.222. The second copy was written in 0.4.220 by reading the first, which is
 * how it inherited a blind spot that was already three hundred releases old, and 0.4.223 then had
 * to fix the same line twice.
 *
 * A type is public because it leaves the barrel, not because of the syntax it left by. That rule
 * now lives in one place, so the next shape either file needs is a change both of them get.
 */

/** Type names exported by one barrel's source, with comments removed first. */
export function exportedTypes(source: string): ReadonlySet<string> {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const names = new Set<string>();

  // Re-export blocks: `export type { A, B as C } from './x.js'`.
  for (const block of stripped.matchAll(/export type \{([^}]*)\} from/g)) {
    for (const entry of (block[1] as string).split(',')) {
      const name = entry.trim().split(' as ').pop()?.trim() ?? '';
      if (/^\w+$/.test(name)) names.add(name);
    }
  }

  // Declared and exported in place: `export interface X {` / `export type X = …`.
  for (const declared of stripped.matchAll(/export (?:interface (\w+)|type (\w+)\s*[=<])/g)) {
    const name = declared[1] ?? declared[2];
    if (name !== undefined) names.add(name);
  }

  return names;
}
