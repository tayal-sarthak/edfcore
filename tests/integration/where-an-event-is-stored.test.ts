/**
 * The annotation channel's layout is not the events.
 *
 * Two things about an EDF+ annotations signal are decisions of the writer and not facts about the
 * recording: how wide the channel is declared, and which record a given TAL was put in.
 * `annotations.md` says the second in as many words — "`recordIndex` is where the event was
 * *stored*, which is not necessarily the record its onset falls in. Writers usually put an event in
 * the record covering it, but nothing in the format requires that" — and says the first by
 * implication: `samplesPerRecord` on that channel is what "buys the writer room for text".
 *
 * Neither was tested as a transformation. `tal/annotations.test.ts` reads events out of fixtures;
 * `annotations-page.test.ts` runs the page's file. Both hold the layout fixed.
 *
 * So the same event is written three ways — into record 0, into record 3 where its onset falls, and
 * into record 5, after it — and the resulting annotation must differ in exactly two fields:
 * `recordIndex`, which is the provenance the page tells you to use it for, and
 * `byteOffsetInRecord`, which is where in that record it landed. Onset, duration, text, channel,
 * both axes and both exact tick counts are identical, and so is every entry of
 * `recordOnsetTicks` — the timekeeping TALs are untouched by where an ordinary one sits.
 *
 * Then the width: the same events in a 20-sample region and in a 120-sample region, which is a
 * record 200 bytes longer and every data offset moved, produce the same list and the same samples.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfAnnotation } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('annotations.md') ?? '').replace(/\s+/g, ' ');

const RECORDS = 6;

/** One event at 3.5 s, written into whichever record the caller names. */
function storedIn(record: number, regionSamples = 40): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 8, sample: (r, i) => r * 8 + i }],
    annotationSignals: [
      {
        samplesPerRecord: regionSamples,
        tals: (at) =>
          at === record ? [{ onset: '+3.5', duration: 1, texts: ['spike@@Fp1'] }] : [],
      },
    ],
  });
}

const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? `${member}n` : member,
  );

/** Everything about the event except where it was put. */
const withoutProvenance = (event: EdfAnnotation): string =>
  shape({ ...event, recordIndex: '(elsewhere)', byteOffsetInRecord: '(elsewhere)' });

async function eventFrom(bytes: Uint8Array): Promise<{
  event: EdfAnnotation;
  onsets: string;
  diagnostics: readonly string[];
}> {
  const recording = await openEdf(byteSource(bytes));
  const result = await readAnnotations(recording, { start: 0, count: RECORDS });
  const [event] = result.annotations;
  if (event === undefined) throw new Error('the fixture carries one event and it was not read');
  return {
    event,
    onsets: [...result.recordOnsetTicks].join(','),
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

describe('the page says where an event sits is provenance', () => {
  it('still says it, in the words this file is about', () => {
    expect(PAGE).toContain(
      '`recordIndex` is where the event was *stored*, which is not necessarily the record its onset falls in',
    );
    expect(PAGE).toContain('use the onset for time and `recordIndex` only for provenance');
  });
});

describe('the same event, stored in three different records', () => {
  const PLACES = [0, 3, 5] as const;

  it('reports the record it was stored in, which is the field that moves', async () => {
    const stored = await Promise.all(PLACES.map((record) => eventFrom(storedIn(record))));
    expect(stored.map(({ event }) => event.recordIndex)).toEqual([...PLACES]);
    // Record 3 is the one the onset falls in; the other two are the cases the page allows for.
    expect(stored[1]?.event.recordIndex).toBe(3);
  });

  it('and is otherwise the same event, on both axes and in exact ticks', async () => {
    const stored = await Promise.all(PLACES.map((record) => eventFrom(storedIn(record))));
    const descriptions = new Set(stored.map(({ event }) => withoutProvenance(event)));
    expect(descriptions.size).toBe(1);

    // Spelled out, so the comparison above cannot pass by comparing two empty objects.
    for (const { event } of stored) {
      expect(event.onsetSecondsFromFirstRecord).toBe(3.5);
      expect(event.onsetTicksFromFirstRecord).toBe(35_000_000n);
      expect(event.onsetTicks).toBe(35_000_000n);
      expect(event.durationSeconds).toBe(1);
      expect(event.text).toBe('spike');
      expect(event.channelLabel).toBe('Fp1');
    }
  });

  it('leaves the record onsets alone, because a timekeeping TAL is not an ordinary one', async () => {
    const stored = await Promise.all(PLACES.map((record) => eventFrom(storedIn(record))));
    expect(new Set(stored.map(({ onsets }) => onsets)).size).toBe(1);
    expect(stored[0]?.onsets.split(',')).toHaveLength(RECORDS);
    expect(new Set(stored.map(({ diagnostics }) => diagnostics.join(',')))).toEqual(new Set(['']));
  });
});

describe('the width of the annotation channel', () => {
  it('changes the record and not the events', async () => {
    const narrow = await openEdf(byteSource(storedIn(3, 20)));
    const wide = await openEdf(byteSource(storedIn(3, 120)));

    // The record really is a different size, and every data offset with it.
    expect(wide.header.recordByteLength - narrow.header.recordByteLength).toBe(200);
    expect(wide.header.signals[1]?.recordByteLength).toBe(240);
    expect(narrow.header.signals[1]?.recordByteLength).toBe(40);

    const narrowEvents = await readAnnotations(narrow, { start: 0, count: RECORDS });
    const wideEvents = await readAnnotations(wide, { start: 0, count: RECORDS });
    expect(shape(wideEvents.annotations)).toBe(shape(narrowEvents.annotations));
    expect([...wideEvents.recordOnsetTicks]).toEqual([...narrowEvents.recordOnsetTicks]);
    expect(wideEvents.diagnostics).toEqual([]);
  });

  it('and leaves the samples where they were, read by signal rather than by offset', async () => {
    const narrow = await openEdf(byteSource(storedIn(3, 20)));
    const wide = await openEdf(byteSource(storedIn(3, 120)));
    const samples = async (recording: typeof narrow): Promise<string> => {
      const chunk = await readRecords(recording, {
        records: { start: 0, count: RECORDS },
        signalIndices: [0],
      });
      const series = chunk.signals[0];
      return [...(series?.digital.subarray(0, series.sampleCount) ?? [])].join(',');
    };
    expect(await samples(wide)).toBe(await samples(narrow));
    expect((await samples(narrow)).split(',')).toHaveLength(RECORDS * 8);
  });
});
