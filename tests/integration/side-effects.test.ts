/**
 * `sideEffects: false` is true — importing edfcore does nothing.
 *
 * The manifest declares it and 0.4.230 checked that the declaration is there. This checks that it
 * is honest, which is a different question and the one a consumer is exposed to: a bundler reads
 * that flag and feels free to drop any import whose bindings are unused. If a module did something
 * at load — registered a handler, patched a global, started a timer — the flag would license the
 * bundler to delete behaviour somebody depends on, and nothing about the failure would point back
 * here.
 *
 * Run in a child process, because "what did importing this do" is a question about a fresh realm.
 * The parent has already imported `src/` a hundred times over by the time any test runs.
 *
 * What is watched is what a load-time side effect looks like in practice: a new property on
 * `globalThis`, a timer, a `process` listener. Not exhaustive — nothing short of a sandbox is —
 * but these are the three a library reaches for, and each is silent from the outside.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = new URL('../../dist/', import.meta.url);

interface Report {
  readonly newGlobals: readonly string[];
  readonly timers: readonly string[];
  readonly listeners: readonly string[];
  readonly exports: Record<string, number>;
}

function importInFreshRealm(): Report {
  if (!existsSync(fileURLToPath(new URL('index.js', DIST)))) {
    // A failure, not a skip — the same rule `browser-safety.test.ts` follows, and for the same
    // reason: a skip here restores exactly the silence this file exists to end.
    throw new Error(
      'dist/index.js is missing, so there is nothing to import. Next: run `npm run build` ' +
        '(`npm run check` builds before it tests for this reason).',
    );
  }

  const script = `
    const before = new Set(Reflect.ownKeys(globalThis).map(String));
    const timers = [];
    for (const name of ['setTimeout', 'setInterval', 'setImmediate']) {
      const original = globalThis[name];
      globalThis[name] = (...args) => { timers.push(name); return original(...args); };
    }
    const listeners = [];
    const addListener = process.on.bind(process);
    process.on = (event, handler) => { listeners.push(event); return addListener(event, handler); };

    const entries = {};
    for (const name of ['index', 'node', 'validate']) {
      const module = await import(${JSON.stringify(fileURLToPath(DIST))} + name + '.js');
      entries[name] = Object.keys(module).length;
    }

    const after = Reflect.ownKeys(globalThis).map(String);
    process.stdout.write(JSON.stringify({
      newGlobals: after.filter((key) => !before.has(key) && !['setTimeout','setInterval','setImmediate'].includes(key)),
      timers,
      listeners,
      exports: entries,
    }));
  `;

  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      encoding: 'utf8',
    }),
  );
}

const REPORT = importInFreshRealm();

describe('the realm actually imported the package', () => {
  it('loaded all three entry points, so a passing run is not a vacuous one', () => {
    // Without this, a child that failed to import anything would report a clean slate.
    expect(REPORT.exports.index).toBeGreaterThan(40);
    expect(REPORT.exports.node).toBeGreaterThan(0);
    expect(REPORT.exports.validate).toBeGreaterThan(0);
  });
});

describe('and importing it did nothing', () => {
  it('added no property to globalThis', () => {
    expect(REPORT.newGlobals, 'globals created by importing edfcore').toEqual([]);
  });

  it('scheduled no timer', () => {
    expect(REPORT.timers, 'timers started by importing edfcore').toEqual([]);
  });

  it('registered no process listener', () => {
    // `src/cli.ts` attaches one to `process.stdout` for EPIPE, and is the `bin` rather than an
    // entry point — nothing in the exports map reaches it, which is what makes that legitimate.
    expect(REPORT.listeners, 'process listeners added by importing edfcore').toEqual([]);
  });
});
