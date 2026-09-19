/**
 * A rejected value, said in a way that cannot read as an accepted one.
 *
 * Layer 1. Imports nothing.
 *
 * Every numeric guard in this package printed the offending value with `${value}`, which is right
 * for a number and wrong for everything else. `Number.isSafeInteger('0')` is false, so the string
 * `'0'` was rejected and then reported as "must be a whole number, received 0" — a sentence whose
 * rule the printed value satisfies. A reader who trusts the message looks past the argument.
 *
 * A BigInt is the case that costs the most. Every instant and every span edfcore hands out is
 * ticks, so passing one back where a number belongs is a mistake the API's own shape invites, and
 * `received 10000000` reads as a plausible value rather than as one out by ten million.
 *
 * Numbers keep their bare spelling, so `NaN`, `Infinity` and a real out-of-range integer say
 * exactly what they said before. This helper only exists for the values that are not numbers at
 * all (0.6.94).
 */

/** The value as a phrase that fits after "received" or "was given". Never a value's contents. */
export function describeValue(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return `the BigInt ${value}n`;
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  /*
   * A binary value is named by its built-in tag — `Uint8Array`, `ArrayBuffer`, `DataView` — because
   * that IS the mistake wherever one turns up: `fileSource(bytes)` is a file already in memory and
   * `decodeHeaderLatin1(buffer)` is a fetch result, and "an object" says nothing a reader can act
   * on. The tag, not `instanceof`: it is the same across realms, which is why `io/bytes.ts` uses it
   * too. Never the contents (0.6.116).
   */
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return Object.prototype.toString.call(value).slice(8, -1);
  }
  /*
   * A PENDING PROMISE, which is the one object worth naming.
   *
   * `assertRecording` made the argument in 0.6.89 and coined the phrase: a forgotten `await` "passes
   * the pending Promise `openEdf` returns", and a message that names an internal field instead says
   * "nothing about the one keyword that fixes it". It then named it for the recording alone.
   *
   * Five async calls in this package resolve to values other guards take: `readHeader` to a header,
   * `buildRecordIndex` to an index, `readWindow` to the chunk array, `validateRecording` to a report,
   * `readAnnotations` to a result. So `formatHeader(readHeader(source))`,
   * `mergeChunks(readWindow(recording, selection))` and `contiguityOf(buildRecordIndex(recording))`
   * are all one keyword short — and every one of them was told it had passed "an object", which is
   * true of the thing they meant to pass too.
   *
   * Named here rather than at each guard, because this is the module whose whole subject is a value
   * "said in a way that cannot read as an accepted one", and roughly forty messages read their
   * subject out of it.
   *
   * A property read, never a call: nothing here awaits, settles or subscribes to anything.
   */
  if (typeof (value as { then?: unknown }).then === 'function') return 'a pending Promise';
  // `an object` covers an array too: a reader who passed one knows which they passed, and printing
  // its contents is how a 512-signal selection ends up on one line behind `edfcore: `.
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/**
 * A record range as written, with each field named as itself.
 *
 * Three modules each carried their own copy of `{ start: ${range.start}, count: ${range.count} }`,
 * and all three interpolated the value raw. A string interpolates as its digits, so the
 * `{ start: '0', count: '1' }` a JSON config or a URL query produces was refused with "records
 * { start: 0, count: 1 } is not inside the 4 data records this file contains" — a range that is
 * plainly inside it — and then told to clamp the range against `header.recordCount`, which for
 * those values is nothing a caller can act on.
 *
 * One home rather than three, for the reason 0.6.121 gives for `isByteArray`: two copies of a
 * rule have to be kept in agreement, and one does not.
 */
export function describeRecordRange(
  range: { readonly start?: unknown; readonly count?: unknown } | null | undefined,
): string {
  return `{ start: ${describeValue(range?.start)}, count: ${describeValue(range?.count)} }`;
}
