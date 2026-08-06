/**
 * The universal build, exercised in a realm with no Node globals.
 *
 * `tests/integration/public-api.test.ts` already walks the module graph and proves nothing
 * reachable from `src/index.ts` IMPORTS a Node built-in. That check cannot see the other half:
 * `process.env`, `Buffer.from`, `setImmediate` and `require` need no import at all, so a single
 * one of them would pass the graph walk and then throw `ReferenceError` in a browser on the first
 * call. Every test in this repository runs under `environment: 'node'`, where such a reference
 * works perfectly.
 *
 * This script is the missing half. It runs as its own process — isolated from vitest, which needs
 * `process` for its own reasons — captures what it needs from Node BEFORE anything is trapped,
 * replaces each Node-only global with a getter that throws the way a browser would, and only then
 * imports `dist/` and drives the public API end to end.
 *
 * Everything it uses afterwards is a global browsers have had since 2020: `atob`, `Blob`,
 * `TextDecoder`, `URL`, `queueMicrotask`. If a line of edfcore reaches for anything else, the
 * getter fires and the name lands in `touched`.
 *
 * Usage: `node tests/support/browser-realm.mjs <base64 EDF> <dist dir URL>`. It prints one line of
 * JSON, and that line is the whole result.
 */

// --- captured before the traps go up ----------------------------------------
const [, , payload, distHref] = process.argv;
const realConsoleLog = console.log.bind(console);
const restoreProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');

/** Names a browser does not define. `require`/`__dirname` are CommonJS-only and absent here. */
const NODE_ONLY = [
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'setImmediate',
  'clearImmediate',
  'global',
];

const touched = [];
const trapped = [];
for (const name of NODE_ONLY) {
  if (Object.getOwnPropertyDescriptor(globalThis, name) === undefined) continue;
  trapped.push(name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      touched.push(name);
      // The exact failure a browser produces, so a stack trace reads the same in both places.
      throw new ReferenceError(`${name} is not defined`);
    },
    // Note this is STRICTER than a browser: `typeof process` is safe in a real browser and
    // throws here, so even feature detection is reported. That is deliberate. DESIGN's rule for
    // the universal entry is no Node built-ins at all, not "no Node built-ins unless guarded",
    // and a guard is a decision worth making on purpose rather than one that slips in.
  });
}

/** The traps have to be provably live, or a clean run proves only that nothing ran. */
let trapsBite = false;
try {
  void Buffer;
} catch (error) {
  trapsBite = error instanceof ReferenceError;
}
// The self-check is not a finding.
touched.length = 0;

const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
const findings = [];
const results = {};

function record(name, value) {
  results[name] = value;
}

async function step(name, body) {
  try {
    return await body();
  } catch (error) {
    findings.push(`${name}: ${error?.stack ?? String(error)}`);
    return undefined;
  }
}

// --- the run ----------------------------------------------------------------

const edfcore = await step('import edfcore', () => import(new URL('index.js', distHref).href));
const validate = await step('import edfcore/validate', () =>
  import(new URL('validate.js', distHref).href),
);

if (edfcore !== undefined && validate !== undefined) {
  await step('parseHeader', () => {
    const header = edfcore.parseHeader(bytes, bytes.byteLength);
    record('variant', header.variant);
    record('signalCount', header.signals.length);
    record('recordCount', header.recordCount);
    record('physicalRange', edfcore.physicalRangeOf(header.signals[0]));
  });

  await step('openEdf + readWindow + toPhysical + mergeChunks', async () => {
    const recording = await edfcore.openEdf(edfcore.byteSource(bytes));
    const chunks = await edfcore.readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: recording.timeline.spanSeconds,
    });
    const merged = edfcore.mergeChunks(chunks);
    record('sampleCount', merged.signals[0].sampleCount);
    const physical = edfcore.toPhysical(recording.header.signals[0], merged.signals[0].digital);
    record('firstPhysical', physical[0]);
    record('headerText', edfcore.formatHeader(recording.header).split('\n')[0]);
  });

  await step('readAnnotations', async () => {
    const recording = await edfcore.openEdf(edfcore.byteSource(bytes));
    const result = await edfcore.readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    record('annotationCount', result.annotations.length);
  });

  await step('readEnvelope', async () => {
    const recording = await edfcore.openEdf(edfcore.byteSource(bytes));
    const envelope = await edfcore.readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: recording.timeline.spanSeconds,
      buckets: 8,
    });
    record('buckets', envelope[0].bucketCount);
  });

  await step('validateRecording', async () => {
    const recording = await edfcore.openEdf(edfcore.byteSource(bytes));
    const report = await validate.validateRecording(recording);
    record('verdict', report.ok);
    record('reportLines', validate.formatValidationReport(report).split('\n').length);
  });

  // `blobSource` over a real `Blob`, which is the browser's own file handle. Node has had the
  // class since 18, so this exercises the same code path a File input would.
  await step('blobSource', async () => {
    const recording = await edfcore.openEdf(edfcore.blobSource(new Blob([bytes])));
    record('blobSignalCount', recording.header.signals.length);
  });

  await step('an EdfError still crosses the boundary as an EdfError', () => {
    try {
      edfcore.parseHeader(new Uint8Array(256), 256);
      findings.push('parseHeader accepted 256 zero bytes');
    } catch (error) {
      record('errorKind', edfcore.isEdfError(error) ? error.edfErrorKind : 'not an EdfError');
    }
  });
}

// --- report -----------------------------------------------------------------

if (restoreProcess !== undefined) Object.defineProperty(globalThis, 'process', restoreProcess);
realConsoleLog(
  `EDFCORE_BROWSER_REALM ${JSON.stringify({ trapped, trapsBite, touched, findings, results })}`,
);
