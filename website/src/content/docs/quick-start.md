---
title: Quick start
description: Open an EDF file in the browser or in Node and get real physical sample values on screen.
section: "Start here"
order: 2
lead: The shortest path from a file the user picked, or a path on disk, to a Float64Array of microvolts. Both runtimes use the same five functions; only the first one differs.
---

## The shape of every read

Five calls do the work, and only the first one is runtime-specific.

1. Wrap the bytes in a `ByteSource` (`blobSource(file)` in a browser, `await fileSource(path)` in Node).
2. `openEdf(source)` parses the header and builds a time axis. It doesn't read the data.
3. `getSignal(header, label)` resolves one channel by label or index.
4. `readWindow(recording, selection)` reads a stretch of time for the channels you name.
5. `toPhysical(signal, digital)` converts the stored integers into the signal's own units.

Everything else in the library is a variation on those.

## How do I read an EDF file in the browser?

Start with a file input. `blobSource` accepts a `File` straight from the picker. There's no intermediate `ArrayBuffer`, so a twelve-hour recording is read in ranges rather than loaded whole.

```html
<input type="file" id="picker" accept=".edf,.bdf">
```

```ts
import { blobSource, getSignal, openEdf, readWindow, toPhysical } from 'edfcore';

const picker = document.querySelector<HTMLInputElement>('#picker')!;

picker.addEventListener('change', async () => {
  const file = picker.files?.[0];
  if (file === undefined) return;

  const recording = await openEdf(blobSource(file));
  const { header } = recording;

  const firstDataIndex = header.dataSignalIndices[0];
  if (firstDataIndex === undefined) return;      // a file with no data channels
  const signal = getSignal(header, firstDataIndex);

  const chunks = await readWindow(recording, {
    startSeconds: 0,
    durationSeconds: 10,
    signalIndices: [signal.index],
  });

  const chunk = chunks[0];
  if (chunk === undefined) return;               // the window is outside the recording

  const values = toPhysical(signal, chunk.signals[0]!.digital);
  console.log(
    `${signal.label}: ${values.length} samples of ${signal.physicalDimension}, ` +
      `${chunk.byteLength} bytes read from disk`,
  );
  console.log(values.subarray(0, 5));
});
```

Against the three-channel file listed in the next section (EEG at 256 Hz, respiration at 16 Hz, and an annotations channel, in one-second records), that prints:

```text
EEG Fpz-Cz: 2560 samples of uV, 6040 bytes read from disk
Float64Array(5) [
  0.007629510948348211,
  11.13145647364004,
  21.583886472877087,
  30.75455863279164,
  38.063630121309224
]
```

Two things in that output are worth pausing on. `values` is a `Float64Array`, because a 24-bit BDF sample scaled into float32 loses about a quarter of a quantisation step. And `chunk.byteLength` is the bytes that actually left the source, which is more than the 5120 bytes those 2560 samples occupy. EDF stores every channel interleaved, and the smallest readable unit is a whole data record. [Concepts](/docs/concepts) has the arithmetic.

`readWindow` returns an *array* of chunks, which is why the example indexes into it. For a continuous file that array holds exactly one chunk whenever the window overlaps the recording. It holds more than one when the window crosses a gap in a discontinuous recording. It's empty when the window contains no records at all, either outside the recording or entirely inside a gap.

## How do I read an EDF file in Node.js?

It's identical after the first line. `fileSource` returns a promise because it opens a file handle, and you close it when you're done. edfcore has no other lifetime mechanism yet, so wrap the work in `try`/`finally`.

```ts
import { getSignal, openEdf, readWindow, toPhysical } from 'edfcore';
import { fileSource } from 'edfcore/node';

const source = await fileSource('./overnight.edf');
try {
  const recording = await openEdf(source);
  const { header } = recording;

  console.log(
    `${header.variant}: ${header.recordCount} records of ${header.recordDurationSeconds} s`,
  );
  for (const signal of header.signals) {
    console.log(
      `  [${signal.index}] ${signal.label} — ${signal.kind}, ` +
        `${signal.samplesPerRecord} samples/record`,
    );
  }

  const eeg = getSignal(header, 'EEG Fpz-Cz');
  const chunks = await readWindow(recording, {
    startSeconds: 60,
    durationSeconds: 10,
    signalIndices: [eeg.index],
  });

  const chunk = chunks[0];
  if (chunk !== undefined) {
    const microvolts = toPhysical(eeg, chunk.signals[0]!.digital);
    console.log(`${microvolts.length} samples, ${chunk.byteLength} bytes read`);
    console.log(Array.from(microvolts.subarray(0, 5)));
  }
} finally {
  await source.close?.();
}
```

```text
EDF+C: 300 records of 1 s
  [0] EEG Fpz-Cz — data, 256 samples/record
  [1] Resp oro-nasal — data, 16 samples/record
  [2] EDF Annotations — annotations, 30 samples/record
2560 samples, 6040 bytes read
[
  -13.939116502632181,
  -24.116884107728694,
  -32.845044632639045,
  -39.604791332875564,
  -43.99938963912413
]
```

Note the third channel. The bytes of `EDF Annotations` are timestamped text, so edfcore reports its `kind` as `'annotations'` and keeps it out of `header.dataSignalIndices`. Passing its index to `readWindow` throws.

`getSignal` matches the trimmed label exactly and case-sensitively. When nothing matches it throws `EdfChannelNotFoundError`, listing every label in the file. When two channels share the label, which real files do, it throws `EdfAmbiguousChannelError`, listing the indices.

## How do I read the events in an EDF+ file?

Annotations come out of their own call, because they live in their own channel and have nothing to do with the sample grid.

```ts
import { openEdf, readAnnotations } from 'edfcore';
import { fileSource } from 'edfcore/node';

const source = await fileSource('./overnight.edf');
try {
  const recording = await openEdf(source);

  const { annotations } = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });

  for (const annotation of annotations) {
    const duration = annotation.durationSeconds;
    console.log(
      `${annotation.onsetSecondsFromFirstRecord.toFixed(3)} s` +
        (duration === undefined ? '' : ` (+${duration} s)`) +
        `  ${annotation.text}`,
    );
  }
} finally {
  await source.close?.();
}
```

```text
30.000 s (+30 s)  Sleep stage W
60.000 s (+30 s)  Sleep stage 1
95.500 s  Arousal
```

The record range is required and has no default. Scanning a whole file for annotations is expensive, so `{ start: 0, count: recording.header.recordCount }` has to appear in your source.

Each annotation carries its onset on **two axes**, each as a float and as an exact `bigint` in 100-nanosecond units. `onsetSecondsFromFirstRecord` and `onsetTicksFromFirstRecord` are rebased to the start of record 0, which is the convention EDFlib, pyEDFlib and MNE use. `onsetSecondsFromHeaderStart` and `onsetTicks` are the verbatim on-disk value. Print the seconds and compare the ticks — from the *same axis*. A file may declare a sub-second start offset in record 0, and that offset is exactly what the two axes differ by, so printing `onsetSecondsFromFirstRecord` beside a comparison on `onsetTicks` puts an event on screen in one place and tests it in another. [Annotations](/docs/annotations) has all four fields side by side.

## Next

[Concepts](/docs/concepts) explains the record grid that all of the above sits on: the record range as the unit of I/O, `samplesPerRecord` as the authoritative field, and the two functions behind digital and physical values. It also covers what changes when a recording has gaps in it.
