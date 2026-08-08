/**
 * The HTTP Range adapter.
 *
 * Layer 5. Turns a URL into random access without downloading the recording, which is the
 * whole reason a 13 GiB BDF can be opened in a browser tab.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * 1. A byte range is INCLUSIVE at both ends. `bytes=0-0` is one byte.
 * 2. A `200 OK` answer to a Range request means the server ignored the header and is sending
 *    the whole resource. That is refused by default — silently buffering gigabytes because a
 *    CDN is misconfigured is exactly the kind of invisible cost this library exists to refuse.
 * 3. The source length must be known before any read, because random access is meaningless
 *    without it. Three ways are tried, cheapest first, and failing to find one is fatal.
 */

import { EdfSourceError } from '../errors.js';
import { requireFiniteOption } from '../options.js';
import type {
  AbortSignalLike,
  ByteSource,
  FetchLike,
  HttpResponseLike,
  HttpSourceOptions,
  ReadOptions,
} from '../types.js';
import { assertExactRead, assertReadRange, throwIfSignalAborted } from './source.js';

/** Small enough to stay polite to a shared origin, large enough to hide latency. */
const DEFAULT_MAX_CONCURRENCY = 4;

const HTTP_PARTIAL_CONTENT = 206;
const HTTP_OK = 200;

type RequestInitLike = { headers: Record<string, string>; method?: string };

/**
 * A promise semaphore. A released slot is handed straight to the next waiter rather than being
 * returned to the pool, so the in-flight count can never overshoot the limit between the
 * release and the waiter resuming on its microtask.
 */
interface Gate {
  acquire(): Promise<void>;
  release(): void;
}

function createGate(limit: number): Gate {
  let active = 0;
  const waiting: Array<() => void> = [];

  return {
    async acquire(): Promise<void> {
      if (active < limit) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
      // The releaser transferred its slot to us, so `active` is deliberately left unchanged.
    },
    release(): void {
      const next = waiting.shift();
      if (next !== undefined) {
        next();
        return;
      }
      active -= 1;
    },
  };
}

/**
 * A real `Headers` lookup is case-insensitive, but `HttpResponseLike` is structural and a
 * hand-written test double usually is not. Both spellings are tried.
 */
function headerOf(response: HttpResponseLike, name: string): string | null {
  return response.headers.get(name) ?? response.headers.get(name.toLowerCase());
}

function parseNonNegativeInteger(text: string | null): number | undefined {
  if (text === null) return undefined;
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * The `first-byte-pos` and `last-byte-pos` of a `Content-Range`, or `undefined` when the header is
 * absent or not in the `bytes <first>-<last>/<total>` form.
 *
 * `undefined` means "no usable claim", never "the range was wrong": a caller-supplied `FetchLike`
 * test double is free to answer every header with `null`, and treating that as corruption would
 * break doubles rather than catch servers. A real 206 always carries the header (RFC 7233 makes it
 * mandatory), so a misbehaving cache is still caught.
 */
function rangeFromContentRange(
  value: string | null,
): { readonly first: number; readonly last: number } | undefined {
  if (value === null) return undefined;
  const match = /^\s*bytes\s+(\d+)-(\d+)\//.exec(value);
  if (match === null) return undefined;
  const first = parseNonNegativeInteger(match[1] ?? null);
  const last = parseNonNegativeInteger(match[2] ?? null);
  if (first === undefined || last === undefined) return undefined;
  return { first, last };
}

/** `Content-Range: bytes 0-0/12345` -> 12345. A `/*` total is unknown, not zero. */
function totalFromContentRange(value: string | null): number | undefined {
  if (value === null) return undefined;
  const slash = value.lastIndexOf('/');
  if (slash < 0) return undefined;
  return parseNonNegativeInteger(value.slice(slash + 1));
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function hrefOf(url: string | { readonly href: string }): string {
  return typeof url === 'string' ? url : url.href;
}

function resolveFetch(options: HttpSourceOptions | undefined): FetchLike {
  const provided = options?.fetch;
  if (provided !== undefined) return provided;
  // `fetch` cannot be named as a global without the DOM lib, so it is reached structurally.
  const ambient = (globalThis as { fetch?: FetchLike }).fetch;
  if (ambient !== undefined) return ambient;
  throw new EdfSourceError(
    'httpSource() found no fetch implementation: this runtime does not expose globalThis.fetch ' +
      'and options.fetch was not given. Next: pass options.fetch with any function matching ' +
      'FetchLike.',
    { offset: 0, requestedLength: 0 },
  );
}

/**
 * `FetchLike` deliberately does not name `signal`: naming it would pull in the real DOM
 * `AbortSignal` by parameter contravariance, the exact dependency the shims exist to avoid. It
 * is still handed to the implementation at runtime.
 *
 * It is attached only when it carries `addEventListener`, i.e. when it genuinely is an
 * `AbortSignal`. The platform `fetch` throws a `TypeError` on anything else, and a caller who
 * passed a bare `{ aborted }` shim is still served by the `throwIfSignalAborted` polls around the
 * request.
 */
function attachSignal(init: RequestInitLike, signal: AbortSignalLike | undefined): void {
  if (signal === undefined) return;
  if (typeof (signal as { addEventListener?: unknown }).addEventListener !== 'function') return;
  (init as { signal?: unknown }).signal = signal;
}

function request(
  fetchImpl: FetchLike,
  href: string,
  headers: Record<string, string>,
  method: 'GET' | 'HEAD',
  signal: AbortSignalLike | undefined,
): Promise<HttpResponseLike> {
  const init: RequestInitLike = { headers, method };
  attachSignal(init, signal);
  return fetchImpl(href, init);
}

function rangeIgnoredError(href: string, offset: number, length: number): EdfSourceError {
  const lastByte = offset + length - 1;
  return new EdfSourceError(
    `The server answered ${HTTP_OK} OK instead of ${HTTP_PARTIAL_CONTENT} Partial Content for ` +
      `Range bytes=${offset}-${lastByte} on ${href}, so it ignored the Range header and is ` +
      'sending the whole resource (HTTP_RANGE_IGNORED). edfcore will not silently buffer a ' +
      'recording nobody asked for. Next: serve the file from an origin or CDN that supports ' +
      'byte ranges, or pass allowFullDownload: true to fetch it once and serve reads from ' +
      'memory.',
    { offset, requestedLength: length },
  );
}

/** What `httpSource` learns before it can serve a single read. */
interface ResolvedSource {
  readonly byteLength: number;
  /** Set only when the length probe already had to download everything. */
  readonly body: Uint8Array | undefined;
}

async function resolveSource(
  fetchImpl: FetchLike,
  href: string,
  baseHeaders: Record<string, string>,
  options: HttpSourceOptions | undefined,
): Promise<ResolvedSource> {
  const signal = options?.signal;
  // Resolution issues its own HEAD and probe requests, so an already-aborted source signal has
  // to be caught here too — otherwise httpSource() itself does network work after cancellation.
  throwIfSignalAborted(signal);

  const declared = options?.byteLength;
  if (declared !== undefined) {
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new EdfSourceError(
        `httpSource() was given options.byteLength ${declared}, which is not a non-negative ` +
          'safe integer. Next: pass the real resource size in bytes, or omit it and let ' +
          'edfcore probe for it.',
        { offset: 0, requestedLength: 0 },
      );
    }
    return { byteLength: declared, body: undefined };
  }

  try {
    const head = await request(fetchImpl, href, baseHeaders, 'HEAD', signal);
    if (isSuccess(head.status)) {
      const length = parseNonNegativeInteger(headerOf(head, 'Content-Length'));
      if (length !== undefined) return { byteLength: length, body: undefined };
    }
  } catch {
    // A rejected or forbidden HEAD is common (CORS, some object stores). Fall through to the
    // one-byte range probe rather than failing on it.
  }

  const probeHeaders = { ...baseHeaders, Range: 'bytes=0-0' };
  const probe = await request(fetchImpl, href, probeHeaders, 'GET', signal);

  if (probe.status === HTTP_PARTIAL_CONTENT) {
    const total = totalFromContentRange(headerOf(probe, 'Content-Range'));
    if (total !== undefined) return { byteLength: total, body: undefined };
  } else if (probe.status === HTTP_OK) {
    // The probe already committed the server to sending everything. Refusing now costs the
    // caller nothing, and accepting means one download instead of two.
    if (options?.allowFullDownload !== true) throw rangeIgnoredError(href, 0, 1);
    const body = new Uint8Array(await probe.arrayBuffer());
    return { byteLength: body.byteLength, body };
  } else if (!isSuccess(probe.status)) {
    throw new EdfSourceError(
      `httpSource() could not read ${href}: the server answered HTTP ${probe.status} to a ` +
        'Range probe. Next: check the URL, its authentication headers and its CORS policy.',
      { offset: 0, requestedLength: 1 },
    );
  }

  throw new EdfSourceError(
    `httpSource() could not determine the size of ${href}: HEAD returned no usable ` +
      'Content-Length and a Range probe returned no Content-Range total, so no byte offset can ' +
      'be addressed and random access is impossible. Next: pass options.byteLength if you know ' +
      'the size, or serve the file from an origin that reports one.',
    { offset: 0, requestedLength: 0 },
  );
}

export async function httpSource(
  url: string | { readonly href: string },
  options?: HttpSourceOptions,
): Promise<ByteSource> {
  const href = hrefOf(url);
  const fetchImpl = resolveFetch(options);
  const baseHeaders: Record<string, string> = { ...options?.headers };
  const gate = createGate(
    Math.max(
      1,
      Math.floor(
        requireFiniteOption(options?.maxConcurrency, 'maxConcurrency', DEFAULT_MAX_CONCURRENCY),
      ),
    ),
  );

  const resolved = await resolveSource(fetchImpl, href, baseHeaders, options);
  const byteLength = resolved.byteLength;
  /** Set once, and only ever when the server ignored Range and the caller allowed it. */
  let fullBody: Uint8Array | undefined = resolved.body;
  /**
   * The one in-flight full download, so a server that ignores Range costs one transfer.
   *
   * Without it, every read that had already entered `fetchRange` issued its own GET, each
   * buffering the whole resource — N concurrent block reads downloaded the file N times and held
   * up to `maxConcurrency` copies at once. That turns a large remote recording into an
   * out-of-memory crash rather than a slow read.
   */
  let fullBodyInflight: Promise<Uint8Array> | undefined;
  /**
   * Settles once one request has revealed whether this server honours Range.
   *
   * Only used when `allowFullDownload` is on. Until the answer is known, a request is a gamble:
   * if the server ignores Range it answers with the entire resource, and `maxConcurrency`
   * requests issued in parallel each pay for a whole copy before any of them can warn the
   * others. Sending the first one alone costs one round trip on the first read and bounds the
   * worst case at a single transfer instead of `maxConcurrency` of them.
   */
  let rangeSupportProbe: Promise<void> | undefined;

  async function fetchRange(
    offset: number,
    length: number,
    readOptions: ReadOptions | undefined,
  ): Promise<Uint8Array> {
    const signal = readOptions?.signal ?? options?.signal;
    // INCLUSIVE end: `bytes=0-0` is one byte, so the last addressed byte is offset+length-1.
    const headers = { ...baseHeaders, Range: `bytes=${offset}-${offset + length - 1}` };

    await gate.acquire();
    try {
      throwIfSignalAborted(signal);
      // Waiting for a gate slot can take arbitrarily long, and in that time another read may
      // have discovered that the server ignores Range. Re-checking here is what stops every
      // queued read from repeating the download the first one already made.
      if (fullBody !== undefined) return sliceFullBody(fullBody, offset, length);
      if (fullBodyInflight !== undefined) {
        return sliceFullBody(await fullBodyInflight, offset, length);
      }

      let announceProbeDone: (() => void) | undefined;
      if (options?.allowFullDownload === true) {
        if (rangeSupportProbe === undefined) {
          rangeSupportProbe = new Promise<void>((resolve) => {
            announceProbeDone = resolve;
          });
        } else {
          // Someone else is finding out. Their answer is ours too.
          await rangeSupportProbe;
          if (fullBody !== undefined) return sliceFullBody(fullBody, offset, length);
          if (fullBodyInflight !== undefined) {
            return sliceFullBody(await fullBodyInflight, offset, length);
          }
        }
      }

      try {
        return await issueRequest(offset, length, headers, signal);
      } finally {
        announceProbeDone?.();
      }
    } finally {
      gate.release();
    }
  }

  async function issueRequest(
    offset: number,
    length: number,
    headers: Record<string, string>,
    signal: AbortSignalLike | undefined,
  ): Promise<Uint8Array> {
    const response = await request(fetchImpl, href, headers, 'GET', signal);

    if (response.status === HTTP_PARTIAL_CONTENT) {
      // WHICH bytes arrived, before how many. `assertExactRead` below is a LENGTH guard and cannot
      // see a right-sized body taken from the wrong offset — which is exactly what a cache, a
      // Service Worker or a CDN edge keyed on URL alone returns when it serves a stored partial
      // body for a differently-ranged request. The samples then decode cleanly, land at the
      // timestamps the caller asked for, and are the wrong seconds of the recording, with nothing
      // anywhere to say so. RFC 7233 makes this header the check against precisely that.
      const claimed = rangeFromContentRange(headerOf(response, 'Content-Range'));
      const expectedLast = offset + length - 1;
      if (claimed !== undefined && (claimed.first !== offset || claimed.last !== expectedLast)) {
        const received = claimed.last - claimed.first + 1;
        // TWO different failures, and they were reported as one. A server that started where it
        // was asked to and simply stopped because the resource ends there has behaved perfectly:
        // the bytes ARE the requested bytes, and what is wrong is the LENGTH this source is
        // working from — a stale HEAD `Content-Length`, a caller-supplied `options.byteLength`, or
        // a file replaced by a shorter one mid-session. Telling that user to bypass a cache sends
        // them to reconfigure a CDN that is behaving correctly, while the response just rejected
        // carries the resource's real size in the header being read (fixed in 0.3.37).
        // BOTH conditions. `claimed.first === offset` alone also matches a 206 that sent MORE than
        // was asked for — a CDN or nginx `slice` edge answering with a whole fixed-size block —
        // and that response then got the short-tail message, which is wrong in every clause: it
        // said the server "stopped at byte 511, because that is the end of a 4096-byte resource",
        // claimed a range plainly inside the length "does not exist", and advised dropping a
        // `byteLength` that is correct. The one fix that would have helped, varying the cache on
        // `Range`, is printed only by the branch it was routed away from. Introduced by the split
        // in 0.3.37 and narrowed here (fixed in 0.3.40).
        if (claimed.first === offset && claimed.last < expectedLast) {
          const total = totalFromContentRange(headerOf(response, 'Content-Range'));
          const realSize = total === undefined ? 'the resource' : `a ${total}-byte resource`;
          throw new EdfSourceError(
            `Reading bytes ${offset}..${expectedLast} of ${href}: the server started where it was ` +
              `asked to and stopped at byte ${claimed.last}, because that is the end of ` +
              `${realSize}. This source was built for ${byteLength} bytes, so the range it was ` +
              'asked for does not exist. The Range header was honoured exactly; the length is ' +
              'what is wrong. Next: drop options.byteLength and let edfcore probe for the size, ' +
              "or check the origin's Content-Length — a stale or proxied HEAD is the usual cause.",
            { offset, requestedLength: length, receivedLength: received },
          );
        }
        throw new EdfSourceError(
          `Reading bytes ${offset}..${expectedLast} of ${href}: the server answered 206 but its ` +
            `Content-Range says it sent bytes ${claimed.first}..${claimed.last} — a different ` +
            'part of the resource. Serving these as the bytes that were asked for would put the ' +
            'wrong samples at the right timestamps. Next: this is usually a cache or CDN keyed on ' +
            'the URL without the Range header; bypass it, or vary on Range.',
          { offset, requestedLength: length, receivedLength: received },
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return assertExactRead(bytes, offset, length);
    }

    if (response.status === HTTP_OK) {
      if (options?.allowFullDownload !== true) throw rangeIgnoredError(href, offset, length);
      if (fullBody !== undefined) return sliceFullBody(fullBody, offset, length);
      // A read that raced us to the same discovery already owns the transfer. Abandon this
      // response body unread and take theirs — either copy is the same resource.
      if (fullBodyInflight === undefined) {
        fullBodyInflight = response
          .arrayBuffer()
          .then((buffer) => {
            const body = new Uint8Array(buffer);
            fullBody = body;
            return body;
          })
          .catch((error: unknown) => {
            // A failed transfer must not poison every later read with a rejected promise.
            fullBodyInflight = undefined;
            throw error;
          });
      }
      return sliceFullBody(await fullBodyInflight, offset, length);
    }

    throw new EdfSourceError(
      `Reading bytes ${offset}..${offset + length - 1} of ${href} failed: the server ` +
        `answered HTTP ${response.status}. Next: check the URL, its authentication headers ` +
        'and whether a signed URL has expired.',
      { offset, requestedLength: length },
    );
  }

  return {
    byteLength,
    async read(offset: number, length: number, readOptions?: ReadOptions): Promise<Uint8Array> {
      // The effective signal, not just the per-read one. A source-level signal is documented as
      // "the default for every request", and honouring it only inside `attachSignal` meant it
      // worked for a real AbortSignal and was a silent no-op for the published
      // `AbortSignalLike` shim, which has no addEventListener to attach to.
      const signal = readOptions?.signal ?? options?.signal;
      throwIfSignalAborted(signal);
      assertReadRange(offset, length, byteLength);
      if (length === 0) return new Uint8Array(0);
      if (fullBody !== undefined) return sliceFullBody(fullBody, offset, length);
      const bytes = await fetchRange(offset, length, readOptions);
      throwIfSignalAborted(signal);
      return bytes;
    },
  };
}

/** `slice`, not `subarray`: the buffered body is retained state and the caller owns its result. */
function sliceFullBody(body: Uint8Array, offset: number, length: number): Uint8Array {
  return assertExactRead(body.slice(offset, offset + length), offset, length);
}
