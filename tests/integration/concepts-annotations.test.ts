/**
 * The annotations-signal section of `concepts.md`, which is the page the README calls the mental
 * model the rest of the API follows from.
 *
 * Two claims in it, and both describe a wrong answer that looks right.
 *
 * "Decoding an annotations channel as samples produces numbers that look exactly like a signal.
 * Text bytes are perfectly valid little-endian integers. There is no wobble in the waveform to
 * tell you something went wrong, and you get a plausible-looking trace made of ASCII." So the
 * refusal is the feature, and the page prints the whole message. It is a plain `RangeError` rather
 * than an `EdfError` "because it can only ever be a caller's mistake and never a file's" — which
 * means a handler branching on `isEdfError` must not catch it, or a caller's bug gets reported as
 * a bad file.
 *
 * "A file with several annotations signals gets timekeeping only in the first one, so edfcore
 * strips the first TAL of that signal alone and leaves the others intact." Stripping it from the
 * others deletes a real event, silently — the annotation is simply not in the list, and nothing
 * says one is missing.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('concepts.md') ?? '';

const WITH_ANNOTATIONS = minimalEdfPlus({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

describe('what an annotations signal is, in the header', () => {
  it('reports its role in all three places the page names', async () => {
    // "reports `kind: 'annotations'`, appears in `header.annotationSignalIndices` rather than
    //  `header.dataSignalIndices`, and gets no `scale`."
    const { header } = await openEdf(byteSource(WITH_ANNOTATIONS));
    const index = header.signals.findIndex((signal) => signal.kind === 'annotations');
    expect(index).toBeGreaterThanOrEqual(0);
    expect([...header.annotationSignalIndices]).toContain(index);
    expect([...header.dataSignalIndices]).not.toContain(index);
    expect(header.signals[index]?.scale).toBeUndefined();
  });
});

describe('the refusal the page prints', () => {
  it('throws the message it quotes, word for word', async () => {
    // Only the page's hard wraps are undone; the message is one line in the package.
    const quoted = /\/\/ (RangeError: signal \d+[\s\S]*?)\n```/.exec(PAGE)?.[1] ?? '';
    expect(quoted).not.toBe('');

    const recording = await openEdf(byteSource(WITH_ANNOTATIONS));
    const index = recording.header.signals.findIndex((signal) => signal.kind === 'annotations');
    let thrown: unknown;
    try {
      await readRecords(recording, {
        records: { start: 0, count: 1 },
        signalIndices: [index],
      });
    } catch (error) {
      thrown = error;
    }
    const expected = quoted
      .split('\n')
      .map((line) => line.replace(/^\/\/ ?/, '').trim())
      .join(' ')
      .replace(/^RangeError: /, '');
    expect((thrown as Error).message).toBe(expected);
  });

  it('is a plain RangeError, so a handler for bad files does not catch it', async () => {
    // "it can only ever be a caller's mistake and never a file's."
    expect(PAGE).toContain("because it can only ever be a caller's mistake and never a file's");
    const recording = await openEdf(byteSource(WITH_ANNOTATIONS));
    const index = recording.header.signals.findIndex((signal) => signal.kind === 'annotations');
    let thrown: unknown;
    try {
      await readRecords(recording, { records: { start: 0, count: 1 }, signalIndices: [index] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(isEdfError(thrown)).toBe(false);
  });

  it('reads the same records happily when only data channels are named', async () => {
    // So the refusal is about the channel rather than about the call.
    const recording = await openEdf(byteSource(WITH_ANNOTATIONS));
    // One chunk, not an array: `readRecords` names its records, so there is nothing to split on.
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [...recording.header.dataSignalIndices],
    });
    expect(chunk.signals[0]?.digital.length).toBe(8);
  });
});

describe('timekeeping belongs to the first annotations signal alone', () => {
  /** Two annotation channels, each with an event as its first TAL of record 1. */
  const TWO = minimalEdfPlus({
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: (record) => (record === 1 ? [{ onset: 1.25, texts: ['First channel'] }] : []),
      },
      {
        samplesPerRecord: 40,
        label: 'EDF Annotations',
        tals: (record) => (record === 1 ? [{ onset: 1.75, texts: ['Second channel'] }] : []),
      },
    ],
  });

  it('is stated on the page', () => {
    expect(PAGE.replace(/\s+/g, ' ')).toContain(
      'strips the first TAL of that signal alone and leaves the others intact',
    );
  });

  it('keeps the first TAL of the second signal, which is a real event', async () => {
    // Stripping it deletes an annotation silently: it is simply not in the list, and nothing says
    // one is missing.
    const recording = await openEdf(byteSource(TWO));
    expect(recording.header.annotationSignalIndices.length).toBe(2);
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const texts = annotations.map((entry) => entry.text);
    expect(texts).toContain('First channel');
    expect(texts).toContain('Second channel');
  });

  it('surfaces the timekeeping TAL as a record onset rather than as an annotation', async () => {
    // "edfcore strips it from `annotations` and surfaces it as `recordOnsetTicks`."
    const recording = await openEdf(byteSource(TWO));
    const result = await readAnnotations(recording, { start: 0, count: 4 });
    expect(result.recordOnsetTicks).toHaveLength(4);
    // No empty-text entry survived into the list: timekeeping carries no text.
    expect(result.annotations.every((entry) => entry.text !== '')).toBe(true);
  });
});
