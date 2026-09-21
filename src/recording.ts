/**
 * The convenience layer: composition over the primitives, and no behaviour of its own.
 *
 * Layer 6. Everything here is a few lines of arrangement around `io/read.ts`, `decode/` and
 * `time/`. That is the point — a facade that made its own decisions would be a second place where
 * the library's rules live, and the rules are what edfcore is.
 *
 * Three shapes are load-bearing:
 *
 * - `readRecords` returns exactly ONE chunk and costs exactly one read. The caller named the
 *   records, so a gap inside them cannot surprise anyone.
 * - `readWindow` ALWAYS returns an array, one chunk per contiguous run, and on a continuous file a
 *   window that selects any records is a single element. If two shapes existed, consumers would
 *   write against the easy one and misbehave on EDF+D. A window entirely inside a gap, past the
 *   end, or of non-positive duration returns `[]` — the last two on a continuous file too, which
 *   is why the sentence above is about windows that select records and not about windows.
 *   Nothing is ever filled in: there is no gap-fill and no gap-fill option.
 * - Chunks stay RECORD-ALIGNED and are therefore usually wider than the window asked for. The
 *   exact per-signal narrowing is `trimToWindow`, which is pure and testable without I/O.
 *
 * Every chunk carries the onsets of the records it contains, verified from the bytes that were
 * already read — annotation regions live inside those bytes, so this costs no extra I/O and makes
 * a sparsely indexed file safe for the data you actually received.
 */

import { decodeDigitalCounted } from './decode/digital.js';
import { EdfChannelNotFoundError } from './errors.js';
import { readHeader, readRecordBytes } from './io/read.js';
import { assertByteSource } from './io/source.js';
import { buildTimeline } from './record-index.js';
import { decodeAnnotations } from './tal/annotations.js';
import { ticksToSeconds } from './tal/ticks.js';
import { describeValue } from './text/describe.js';
import { assertMonotonicOnsetArray } from './time/timeline.js';
import { resolveTimeWindow } from './time/window.js';
import type {
  ByteSource,
  DecodeAnnotationsOptions,
  EdfAnnotationsResult,
  EdfChunk,
  EdfChunkSignal,
  EdfGap,
  EdfHeader,
  EdfRecordIndex,
  EdfRecording,
  EdfSignal,
  EdfTimeline,
  OpenOptions,
  ReadOptions,
  RecordRange,
  RecordSelection,
  WindowSelection,
} from './types.js';

/**
 * Open a recording: the header, then the timeline.
 *
 * Never scans the file. On a plain EDF or BDF this is two reads in total; on an EDF+ or BDF+ file
 * it is two more, probing the first and last records for their timekeeping onsets.
 */
export async function openEdf(source: ByteSource, options?: OpenOptions): Promise<EdfRecording> {
  // Before any read, so `openEdf(bytes)` is answered by name rather than by whatever fails first.
  assertByteSource(source);
  const header = await readHeader(source, options);
  const { timeline, index } = await buildTimeline(source, header, options);
  return { source, header, timeline, index };
}

/**
 * The signals to decode, deduplicated and in the order given.
 *
 * An annotation signal is refused with a plain `RangeError` rather than an `EdfError`: its bytes
 * are TAL text, and decoding them as samples produces numbers that look exactly like a signal.
 * That is the failure this library exists to prevent, and it can only ever be a caller's mistake.
 *
 * Exported for `stream.ts`, which must produce the byte-identical refusal `readWindow` does — not
 * for the barrel. Validating a selection is not a public operation.
 */
/**
 * What arrived, for a selection that is not an array. Never prints the value: it could be huge.
 *
 * The article is written out here rather than left off, which `io/source.ts` chose for its own
 * version and gave the reason for: "An article needs to know that `Uint8Array` is said 'yoo-int',
 * which no rule about vowels gets right, and getting it wrong is the kind of thing a reader notices
 * instead of the message." That is the cost, and this hard-coded `a` was paying it — on `object`,
 * which is exactly what the two arguments that reach it here are when they are wrong. A `Set` of
 * indices, a `Map` from a config, an object keyed by label: `signalIndices is a object`. A header,
 * a chunk or `header.signals` where the recording belongs: `the recording is a object`.
 *
 * No rule about vowels is needed. `undefined` and `null` are answered above without an article at
 * all, and of the seven strings `typeof` can still return here — object, boolean, number, bigint,
 * string, symbol, function — exactly one begins with a vowel.
 */
function describeSelection(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'missing';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/**
 * The SELECTION itself, before any field of it is read.
 *
 * `assertSignalIndices` below makes this argument already — "TypeScript is not the only way in. A
 * selection built from JSON, from a config file, from a JavaScript call site…" — and it was made
 * one level too deep. Reaching that guard means dereferencing `selection`, so a caller who
 * omitted the whole object got `Cannot read properties of undefined (reading 'signalIndices')`
 * from V8 instead: a `TypeError` with no `Next:` clause, naming an internal field rather than the
 * argument, from a package whose plain `RangeError` is what a caller mistake is supposed to look
 * like. `readWindow`, `readRecords`, `readEnvelope`, `streamRecords` and `readTriggers` all did
 * it, each naming whichever field it happened to read first (fixed in 0.6.79).
 *
 * `shape` is the call's own selection spelled out, so the message names what to pass rather than
 * what was missing.
 */
export function assertSelection(
  selection: unknown,
  call: string,
  shape: string,
  /*
   * The call to reach for INSTEAD, when the selection names records.
   *
   * 0.6.87 wrote "or call readRecords(), which is the one that takes records" into the branch
   * below, and it is true of the caller it was written for: `readWindow` and `readRecords` are the
   * same read in two units. The clause is shared by five calls, and it is the sibling of two of
   * them. `readEnvelope` and `readEnvelopeAtResolution` have no records form — `readRecords` hands
   * back samples, and turning those into an envelope is a second call, `envelopeOfSamples`. And
   * `readTriggers` has no records form at all: it decodes BioSemi trigger EVENTS, so a reader who
   * takes the advice gets the Status channel's samples and still has to find that channel
   * themselves.
   *
   * Defaulted, so the two calls the sentence was written for keep it verbatim.
   */
  recordsForm = 'or call readRecords(), which is the one that takes records.',
): void {
  if (typeof selection !== 'object' || selection === null) {
    throw new RangeError(
      `${call}(): the selection is ${describeSelection(selection)}, not an object. ` +
        `Next: pass ${shape}.`,
    );
  }
  /*
   * An ARRAY, which is an object, so the check above let it through.
   *
   * 0.6.79 added that check because a selection that was not an object made each of these calls
   * name "whichever field it happened to read first". An array reproduces exactly that: `[0]` —
   * the signal indices, passed as the selection, which is the shortest thing a caller can write
   * and the only argument several of these calls need to differ on — made `readWindow` blame
   * `signalIndices`, `readEnvelope` blame `buckets`, `readEnvelopeAtResolution` blame
   * `secondsPerBucket` and `readTriggers` blame the file for having no Status channel.
   *
   * `readWindow`'s was the worst of the four, because it is the one a caller acts on: "signalIndices
   * is missing, not an array of signal indices ... Next: pass header.dataSignalIndices for all of
   * the data signals, or an array of the indices you want" — and an array of the indices they
   * wanted is precisely what they passed.
   */
  if (Array.isArray(selection)) {
    throw new RangeError(
      `${call}(): the selection is an array, and signalIndices is a field on the selection ` +
        `rather than being it. Next: pass ${shape}.`,
    );
  }
  /*
   * A record range where a window belongs, which is the one wrong SHAPE worth naming separately.
   * `readRecords` takes `{ records }` and `streamRecords` takes a window — and is called
   * streamRECORDS — so `streamRecords(recording, { records })` is the shape its own name and its
   * sibling both suggest. It reached the seconds-to-ticks conversion with nothing to convert and
   * earned "startSeconds must be a finite number of seconds, but was undefined. Next: check the
   * expression that produced it —
   * Number() on an absent environment variable…", which sends the reader to look for a `Number()`
   * on a config key rather than at the argument they wrote (fixed in 0.6.87).
   */
  const given = selection as { records?: unknown; startSeconds?: unknown };
  if (given.records !== undefined && given.startSeconds === undefined && shape.includes('start')) {
    throw new RangeError(
      `${call}(): the selection has a \`records\` range, and this call takes a time window. ` +
        `Next: pass ${shape} — ${recordsForm}`,
    );
  }
  /*
   * And the OTHER WAY, which 0.6.87 left open. `readRecords` is the one call in this family that
   * takes no seconds at all, and it sits directly beside `readWindow` in the barrel, in the docs and
   * in `recording.ts` itself — so `readRecords(recording, { signalIndices, startSeconds,
   * durationSeconds })` is as easy to write as the mistake above, and rather easier to believe,
   * since every other read here is bounded in seconds.
   *
   * It reached `assertRecordRange` with no range to check and was refused as
   * `records { start: undefined, count: undefined } is not inside the 6 data records this file
   * contains`, then told to clamp that range or to call `index.locate(seconds)` — advice about
   * bounds for a caller whose bounds were fine and in the unit the sibling call takes.
   */
  if (given.startSeconds !== undefined && given.records === undefined && !shape.includes('start')) {
    throw new RangeError(
      `${call}(): the selection is a time window, and this call takes a \`records\` range. ` +
        `Next: pass ${shape} — or call readWindow(), which is the one that takes seconds.`,
    );
  }
}

/**
 * The RECORDING itself, before any field of it is read.
 *
 * `assertSelection` above checks the second argument; the first one was never checked at all, and
 * the mistake it invites is the one every async API invites. A forgotten `await` passes the
 * pending Promise `openEdf` returns, and it reached `recording.header.signals` and threw V8's
 * `Cannot read properties of undefined (reading 'signals')` — a `TypeError` with no `Next:`
 * clause, naming an internal field rather than the argument, and saying nothing about the one
 * keyword that fixes it (fixed in 0.6.89).
 */
export function assertRecording(
  recording: unknown,
  call: string,
): asserts recording is EdfRecording {
  const given = recording as
    | { header?: unknown; then?: unknown; signals?: unknown }
    | null
    | undefined;
  if (given != null && typeof given.header === 'object' && given.header !== null) return;
  /*
   * A header where a recording belongs, which is the one wrong first argument worth naming
   * separately. Every primitive in this package takes the header — `getSignal`, `decodeDigital`,
   * `formatHeader`, `trimToWindow` — so `readWindow(edf.header, window)` is the shape the rest of
   * the API teaches. It landed on the same `Cannot read properties of undefined (reading
   * 'signals')` a forgotten `await` did, which tells the two apart not at all (fixed in 0.6.90).
   */
  if (Array.isArray(given?.signals)) {
    throw new RangeError(
      `${call}(): that is a header, not a recording — a recording also carries the source, the ` +
        'timeline and the index, and this call needs all three. Next: pass what ' +
        'openEdf(source) resolved to, rather than its .header.',
    );
  }
  /*
   * "Not the object openEdf() returns", said to someone holding the object openEdf() returns.
   *
   * `openEdf(source)` is async, so the object it returns IS a pending Promise — which is the one
   * branch of this sentence where the tail denies what the head just named. The recording is what
   * that Promise RESOLVES to, and every sibling guard in the package says it that way: 0.6.215 for
   * the index ("it resolves to the index this takes"), 0.6.217 for the header, 0.6.229 for
   * `validateHeader`. This is the guard all five reading calls share, and it was the one saying
   * the opposite.
   *
   * The other arm is untouched: a number, a string or an object is not what `openEdf` returns, and
   * for those the sentence was always true.
   */
  if (typeof given?.then === 'function') {
    throw new RangeError(
      `${call}(): the recording is a pending Promise — openEdf(source) is async, so that is what ` +
        'it returns, and the recording is what it resolves to. Next: pass `await ' +
        'openEdf(source)`.',
    );
  }
  throw new RangeError(
    `${call}(): the recording is ${describeSelection(recording)}, not the object openEdf() ` +
      'returns. Next: pass `await openEdf(source)`.',
  );
}

/**
 * The one required option with no default, refused in edfcore's own words.
 *
 * `reading-signals.md` explains why there is no "all signals" default: so that the whole of a
 * 256-channel file is never read because an argument was omitted. Omitting it was a caller
 * mistake the type system catches — and TypeScript is not the only way in. A selection built from
 * JSON, from a config file, from a JavaScript call site, or from an object spread that dropped a
 * key arrives at run time, and until 0.4.442 it produced `TypeError: signalIndices is not
 * iterable`: no `Next:` clause, no mention of edfcore, and nothing naming the option. Every other
 * bad argument on this path already says what to pass instead (fixed in 0.4.442).
 *
 * No caller prefix, for the reason `resolveSignals` below carries none: it is shared by
 * `readWindow`, `readRecords`, `streamRecords` and the envelope calls, and a hard-coded name is
 * wrong for all but one of them. `envelope.test.ts` records that exact mistake being made by three
 * functions sharing two helpers (0.3.35). The option's own name is what a caller needs.
 */
export function assertSignalIndices(signalIndices: unknown): void {
  if (Array.isArray(signalIndices)) return;
  throw new RangeError(
    `signalIndices is ${describeSelection(signalIndices)}, not an array of signal ` +
      'indices. There is no "all signals" default, so that the whole of a 256-channel file is ' +
      'never read because an argument was omitted. Next: pass header.dataSignalIndices for all ' +
      'of the data signals, or an array of the indices you want.',
  );
}

/**
 * The refusal for a signal index the file does not have, in ONE place.
 *
 * `envelope.ts` keeps its own copy of this loop and its comment says why: "The same refusal
 * `resolveSignals` gives, from the resolver the envelope path uses instead", and, of this error
 * specifically, that the identical mistake once "threw a typed error carrying `selector` and
 * `availableLabels` from `readWindow` and a bare `RangeError` from here, so `isEdfError` answered
 * differently depending on which read the caller had reached for".
 *
 * The class was made to match. The MESSAGE was not: the envelope's copy ends "Next: pass an index
 * from header.dataSignalIndices" and stops there, without the clause naming the function that
 * takes a label. A label is the commonest way to arrive here — `getSignal(header, selector)`
 * accepts one, so naming channels is the habit the rest of the package teaches — and the half of
 * the advice that fixes it was the half `readEnvelope` withheld.
 *
 * Two copies of a sentence have to be kept in agreement and one does not, which is the argument
 * 0.6.121 makes for `isByteArray` (fixed in 0.6.136).
 */
export function channelNotFound(header: EdfHeader, signalIndex: number): EdfChannelNotFoundError {
  /*
   * A SIGNAL where its index belongs, which the advice below sent a reader straight back to.
   *
   * `matchSignals(header, /EEG/)` and `getSignal(header, label)` return `EdfSignal`s, and they are
   * how the package teaches a caller to find channels by name — so
   * `readWindow(recording, { signalIndices: matchSignals(header, pattern), … })` is the selection
   * that gets written, and every one of the five reading calls answered
   * `signalIndex [object Object] is outside the 3 signals this file declares`. The value was
   * interpolated raw, which is the defect `describeValue` exists for (0.6.94), and the next step
   * named `getSignal(header, label)` — the call that returns the very thing being refused.
   *
   * The index is one field away: `signal.index`, which every `EdfSignal` carries.
   */
  if (typeof (signalIndex as { index?: unknown } | null | undefined)?.index === 'number') {
    return new EdfChannelNotFoundError(
      'signalIndices holds a signal rather than an index: matchSignals() and getSignal() return ' +
        'signals, and the index is one field on each. Next: pass signal.index for every channel ' +
        'you matched, or header.dataSignalIndices for all of the data signals.',
      { selector: signalIndex, availableLabels: header.signals.map((s) => s.label) },
    );
  }
  /*
   * WHY it was refused, in the third place this package resolves a signal by index.
   *
   * 0.6.93 drew the distinction in `getSignal`: 1.5 "is not a whole number, so it falls between
   * two signals rather than outside them". 0.6.133 carried it to `sample-locate.ts`, whose comment
   * says a label "is not outside anything" and calls itself "the other copy of that message". It
   * was not the other copy — the five reading calls share THIS one, and it still answered
   * `signalIndex EEG Fpz-Cz is outside the 3 signals this file declares` for a label, one clause
   * above advice naming the function that takes labels, and the same sentence for `1.5` and for a
   * bare object: the raw interpolation the branch above quotes as the defect it was fixing.
   */
  // The canonical decimal string is a SPELLING of an index here, not text: `header.signals['9']`
  // is the property access `header.signals[9]` is, which is the coercion
  // `a-selection-from-json.test.ts` names and 0.6.135 deduplicates against. Diagnosed as the index
  // it spells, so `'9'` stays out of range rather than becoming not a number. Nothing else coerces:
  // `'  9  '` and `''` are not spellings this header can be indexed by, and saying 9 or 0 for them
  // would name a signal the caller never wrote.
  const index =
    typeof signalIndex === 'string' && signalIndex === String(Number(signalIndex))
      ? Number(signalIndex)
      : signalIndex;
  const problem = !Number.isFinite(index)
    ? `signalIndex is ${describeValue(signalIndex)}, not a number this header can be indexed by`
    : Number.isInteger(index)
      ? `signalIndex ${index} is outside the ${header.signals.length} signals this file declares`
      : `signalIndex ${index} is not a whole number, so it falls between two signals ` +
        'rather than outside them';
  return new EdfChannelNotFoundError(
    `${problem}. Next: pass an index from header.dataSignalIndices, or resolve one with ` +
      'getSignal(header, label).',
    { selector: signalIndex, availableLabels: header.signals.map((s) => s.label) },
  );
}

export function resolveSignals(
  header: EdfHeader,
  signalIndices: readonly number[],
): readonly EdfSignal[] {
  assertSignalIndices(signalIndices);
  const seen = new Set<number>();
  const signals: EdfSignal[] = [];
  for (const signalIndex of signalIndices) {
    const signal = header.signals[signalIndex];
    if (signal === undefined) throw channelNotFound(header, signalIndex);
    if (signal.kind === 'annotations') {
      throw new RangeError(
        `signal ${signalIndex} (${JSON.stringify(signal.label)}) is this file's annotations ` +
          'channel: its bytes are TAL text, not samples, so decoding them as samples would ' +
          'produce numbers that look like a signal. Next: call readAnnotations(recording, ' +
          'records) for it, and pass only header.dataSignalIndices here.',
      );
    }
    /*
     * Deduplicated on the index the selection RESOLVED to, not on the value that was written.
     *
     * `a-selection-from-json.test.ts` names the one shape accepted by coercion — the canonical
     * decimal string, "which is what `JSON.parse('[\"0\"]')` from a query string gives" — and
     * argues it is safe because "the chunk that comes back reports `signalIndex` as a number, so
     * nothing downstream carries the string". Both are true. What neither covers is the MIXED
     * array, and mixing is how the string arrives: a numeric default merged with `Object.keys()`,
     * a saved view, or a query parameter.
     *
     * `seen` held the values as written, and `'0'` is not `0`, so `[0, '0']` was deduplicated
     * against nothing. The same channel was read twice, its bytes decoded twice, and it came back
     * twice in `chunk.signals` — both entries reporting `signalIndex: 0`, so nothing downstream
     * could tell the copy from the original (fixed in 0.6.135).
     */
    if (seen.has(signal.index)) continue;
    seen.add(signal.index);
    signals.push(signal);
  }
  return signals;
}

/**
 * The header-axis onset of `recordStart`, when a scanned index knows where that record is.
 *
 * `undefined` for a probed index, where nothing better than the nominal grid is available and the
 * caller falls back to it.
 *
 * Two things here are easy to get wrong, and 0.3.38 got both wrong at once.
 *
 * `segment.startTicks` is REBASED — `buildSegmentation` stores `absoluteOnset - originTicks` with
 * `originTicks = timeline.startOffsetTicks` — while the caller consumes this as a header-axis
 * value and subtracts the offset again. On a file whose record 0 begins part-way into a second,
 * which is exactly what record 0's timekeeping TAL is for, a zero-record chunk at record 0 came
 * back at **-0.25 s**: before the instant that defines t = 0. At a segment boundary it reported
 * 99.75 s while carrying a gap that ends at 100 s — the self-contradiction 0.3.38 existed to
 * remove, reintroduced one line away by the fix for it.
 *
 * And it matched only a segment's FIRST record, so a mid-segment record fell through to the
 * nominal grid, which knows nothing about gaps: `readRecords({ start: 5, count: 0 })` said 5 s
 * where `{ start: 5, count: 1 }` said 101 s, for the same record of the same file. Reading the
 * segment that CONTAINS the record answers both the same way (fixed in 0.3.57).
 */
function recordOnsetTicks(
  index: EdfRecordIndex,
  timeline: EdfTimeline,
  recordStart: number,
  durationTicks: bigint,
): bigint | undefined {
  const segment = index.segments?.find(
    (candidate) =>
      candidate.records.start <= recordStart &&
      recordStart < candidate.records.start + candidate.records.count,
  );
  if (segment === undefined) return undefined;
  return (
    timeline.startOffsetTicks +
    segment.startTicks +
    BigInt(recordStart - segment.records.start) * durationTicks
  );
}

/**
 * The gap immediately before `recordStart`, when the index knows where the gaps are.
 *
 * `undefined` for a probed index, and that is not a claim that there is no gap — it is the honest
 * answer that nobody has read the onsets in between. `buildRecordIndex()` is what turns the
 * question into an answerable one.
 *
 * Exported for `envelope.ts`, so an envelope chunk reports a gap exactly as a read chunk does.
 */
export function gapBefore(index: EdfRecordIndex, recordStart: number): EdfGap | undefined {
  const { segments, gaps } = index;
  if (segments === undefined || gaps === undefined) return undefined;
  for (const gap of gaps) {
    const after = segments[gap.afterSegmentIndex];
    if (after !== undefined && after.records.start === recordStart) return gap;
  }
  return undefined;
}

/**
 * One record range in, one chunk out, one read.
 *
 * The annotation regions of these records are already inside the bytes that were read, so their
 * onsets are decoded and checked for free. That is what makes `chunk.startSeconds` the record's
 * TRUE start on an EDF+D file rather than a nominal `start * recordDuration` that a gap would
 * have invalidated.
 */
async function readChunk(
  recording: EdfRecording,
  records: RecordRange,
  signalIndices: readonly number[],
  options?: ReadOptions,
): Promise<EdfChunk> {
  const { source, header, timeline, index } = recording;
  const signals = resolveSignals(header, signalIndices);

  const bytes = await readRecordBytes(source, header, records, options);
  const byteOffset = header.headerByteLength + records.start * header.recordByteLength;

  // Never strict, and not because the flag was lost: a read that threw on an impolite TAL in a
  // record the caller asked for would return no samples at all over a defect in a different
  // channel. The defects land on `chunk.diagnostics`, next to the data they were found beside.
  // `originTicks` is the recording's own start, not this range's. It is already known here — the
  // next few lines rebase against it — and without passing it down, a first record whose
  // timekeeping TAL is missing derived its onset from zero. The same record then reported one
  // start time when read alone and another when read beside a neighbour that did carry a TAL,
  // and that start is the grid origin trimToWindow measures from.
  const annotations = decodeAnnotations(header, bytes, records, {
    originTicks: timeline.startOffsetTicks,
  });
  const onsets = annotations.recordOnsetTicks;
  assertMonotonicOnsetArray(onsets, records.start);

  const durationTicks = header.recordDurationTicks;
  // The nominal grid is the last resort, and a ZERO-RECORD range reaches it every time: there is
  // no onset to observe, because there are no records. On an EDF+D file that made the empty chunk
  // contradict itself — `readRecords({ start: 3, count: 0 })` reported `startSeconds` 3 (the
  // nominal grid) while carrying a `precededByGap` running 3..13 s, so one object claimed to
  // start at 3 s and to be preceded by a gap ending at 13 s, where record 3 truly starts.
  //
  // A scanned index knows where that record is, and `gapBefore` below already reads it from the
  // same place. Consulting it costs nothing and makes the two fields agree (fixed in 0.3.38).
  const nominalFirstTicks =
    recordOnsetTicks(index, timeline, records.start, durationTicks) ??
    timeline.startOffsetTicks + BigInt(records.start) * durationTicks;
  const firstOnsetTicks = onsets[0] ?? nominalFirstTicks;
  const lastOnsetTicks =
    records.count > 0 ? (onsets[records.count - 1] ?? firstOnsetTicks) : firstOnsetTicks;
  const startTicks = firstOnsetTicks - timeline.startOffsetTicks;
  // The SPAN of the chunk, not the time it covers: they are equal for one contiguous run, which
  // is what readWindow produces, and they differ when a caller names records across a gap.
  const spanTicks = records.count > 0 ? lastOnsetTicks + durationTicks - firstOnsetTicks : 0n;
  const startSeconds = ticksToSeconds(startTicks);

  const chunkSignals: EdfChunkSignal[] = signals.map((signal) => {
    const decoded = decodeDigitalCounted(header, bytes, records, signal.index, undefined, options);
    return {
      signalIndex: signal.index,
      sampleCount: decoded.digital.length,
      digital: decoded.digital,
      firstSampleIndex: records.start * signal.samplesPerRecord,
      startSeconds,
      startTicks,
      outOfDigitalRangeCount: decoded.outOfDigitalRangeCount,
    };
  });

  return {
    records,
    startSeconds,
    startTicks,
    durationSeconds: ticksToSeconds(spanTicks),
    durationTicks: spanTicks,
    byteOffset,
    byteLength: bytes.length,
    signals: Object.freeze(chunkSignals),
    precededByGap: gapBefore(index, records.start),
    diagnostics: annotations.diagnostics,
  };
}

/** Exactly one chunk and exactly one read: you named the records, so gaps cannot surprise you. */
export async function readRecords(
  recording: EdfRecording,
  selection: RecordSelection,
  options?: ReadOptions,
): Promise<EdfChunk> {
  assertRecording(recording, 'readRecords');
  assertSelection(selection, 'readRecords', '{ records, signalIndices }');
  return readChunk(recording, selection.records, selection.signalIndices, options);
}

/**
 * A time window, as one chunk per contiguous run of records.
 *
 * Always an array. `[]` means the window is entirely inside a gap or entirely outside the
 * recording — never that the read failed. Chunks are record-aligned and may be wider than asked
 * for; `trimToWindow(header, chunkSignal, startSeconds, durationSeconds)` narrows them exactly.
 *
 * Runs are read one after another rather than concurrently, so the read pattern a caller observes
 * is the one this function issued, in order, with no burst it did not ask for. Concurrency over a
 * `ByteSource` belongs to the source — `httpSource` has `maxConcurrency` — not here.
 *
 * On a discontinuous file a probed index cannot map seconds to records; `resolveTimeWindow`
 * refuses rather than guessing. Build a complete index and rebuild the recording around it:
 * `const index = await buildRecordIndex(rec); await readWindow({ ...rec, index }, selection)`.
 */
export async function readWindow(
  recording: EdfRecording,
  selection: WindowSelection,
  options?: ReadOptions,
): Promise<readonly EdfChunk[]> {
  /*
   * Validate the selection before deciding whether it selects anything.
   *
   * `resolveSignals` runs inside `readChunk`, which only runs once the window has resolved to at
   * least one record. A signalIndices that names a channel this file does not have, or names the
   * annotations channel, therefore threw for a window over data and returned `[]` for a window
   * past the end — the same mistake reported two different ways.
   *
   * `[]` means "no records in this window", and letting a bad argument produce it hands the
   * caller a wrong diagnosis at the worst moment: an out-of-range index silently reads as an
   * empty stretch of recording. A caller mistake is a caller mistake wherever the window lands.
   */
  assertRecording(recording, 'readWindow');
  assertSelection(selection, 'readWindow', '{ signalIndices, startSeconds, durationSeconds }');
  resolveSignals(recording.header, selection.signalIndices);

  const ranges = resolveTimeWindow(
    recording.timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  const chunks: EdfChunk[] = [];
  for (const records of ranges) {
    chunks.push(await readChunk(recording, records, selection.signalIndices, options));
  }
  return Object.freeze(chunks);
}

/**
 * The annotations in a record range, in one read.
 *
 * `records` is required and has no default. A full-file annotation scan is a legitimate thing to
 * want and an expensive thing to do by accident, so it is always visible in the caller's source
 * as `{ start: 0, count: recording.header.recordCount }`.
 */
export async function readAnnotations(
  recording: EdfRecording,
  records: RecordRange,
  options?: DecodeAnnotationsOptions & ReadOptions,
): Promise<EdfAnnotationsResult> {
  assertRecording(recording, 'readAnnotations');
  const bytes = await readRecordBytes(recording.source, recording.header, records, options);
  // The timeline knows record 0's sub-second start offset; a range that does not contain record 0
  // cannot derive it, and on an EDF+D file the derivation gives a value outside [0, 1) and the
  // rebasing switches off. Passing it makes the same annotation read the same way from a partial
  // decode as from a whole-file one — which is the point of `readAnnotations(edf, chunk.records)`.
  return decodeAnnotations(recording.header, bytes, records, {
    startOffsetTicks: recording.timeline.startOffsetTicks,
    ...options,
  });
}
