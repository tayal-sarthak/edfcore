---
title: Migrating to 0.3
description: What changes in 0.3.0, why, and the find-and-replace that covers most of it.
section: Guides
order: 9
lead: One rename, no behaviour change. If your recordings are contiguous — every plain EDF and every EDF+C — a find-and-replace is the whole migration.
---

## The change

Three functions are renamed. Nothing else in the public API changes, and no arithmetic changes.

| 0.2 | 0.3 |
|---|---|
| `sampleIndexAt` | `gridSampleIndexAt` |
| `sampleStartTicks` | `gridSampleStartTicks` |
| `sampleStartSeconds` | `gridSampleStartSeconds` |

Same arguments, same return values, same rounding. They were marked `@deprecated` in 0.2.61, so an
editor has been pointing at the replacement for a release already.

## Why a rename is worth a minor bump

These functions measure the signal's own **sample grid**: sample `n` is the `n`th sample the file
stores for that signal, at `n × recordDuration / samplesPerRecord`. On a contiguous recording that
is also elapsed recording time, and the two ideas are the same number — which is exactly why the
difference was easy to miss.

On a **discontinuous** file they part company. Samples are adjacent in the array across a gap while
their times are not, so on a file with a seven-second hole after record 2:

```ts
sampleStartSeconds(signal, 12, d);   // 3   — the twelfth sample on the grid
// record 3 truly begins at 10 s
```

Both numbers are correct about different things. The name said neither.

This project has shipped six separate fixes for one defect: a function deriving a time from the
nominal grid while every other function used the record's true onset. `readTriggers` reported a
stimulus latched at 10 s as 2 s; `filterAnnotationsByTime` put events in the neighbouring window;
`mergeChunks` could not see a gap. Each was found late, and each was found because two functions
disagreed rather than because one looked wrong. The `grid` prefix is what stops the seventh: you
cannot call `gridSampleStartSeconds` and believe you asked for elapsed recording time.

The functions themselves were never wrong, and they are not deprecated in favour of nothing — they
are the right tool when you have a signal and no recording, which is the whole reason they take no
index.

## If your file might have gaps

Use the recording-aware forms added in 0.2.60. They take the recording, so a gap is in their
arguments:

```ts
import { sampleAt, sampleStartTicksOf, sampleStartSecondsOf } from 'edfcore';

sampleAt(recording, eeg.index, 3612.5);           // EdfSampleLocation, or undefined
sampleStartSecondsOf(recording, eeg.index, 940);  // when sample 940 actually starts
```

`sampleAt` can return **`undefined`**, which the grid form structurally cannot: no sample exists at
that instant, because it falls in a gap, before the recording, or after it. Given only a signal and
a record duration, `gridSampleIndexAt` always returns an index — including one past the end of the
file.

Both refuse a probed index on a file with gaps rather than guessing. `contiguityOf(index)` tells
you which regime you are in; `await buildRecordIndex(recording)` is what turns `'unknown'` into an
answer.

## Doing the migration

**If your recordings are contiguous** — every plain EDF and every EDF+C, which is most files — the
rename is the only thing that affects you:

```bash
sed -i '' \
  -e 's/\bsampleIndexAt\b/gridSampleIndexAt/g' \
  -e 's/\bsampleStartTicks\b/gridSampleStartTicks/g' \
  -e 's/\bsampleStartSeconds\b/gridSampleStartSeconds/g' \
  $(git ls-files '*.ts' '*.js')
```

Mind the order if you write your own: `sampleStartSeconds` is not a prefix of anything here, but
`sampleStartTicks` and `sampleStartTicksOf` are distinct names and a substring replace would damage
the second. The `\b` word boundaries above are what prevent that.

**If you handle EDF+D**, treat the rename as a prompt to check each call site. Any place you were
converting a time to a sample index, or a sample index to a time, and the file may have gaps, wants
the recording-aware form instead. `tests/property/timebase.test.ts` in the repository shows both
regimes side by side against one fixture.

## What is not changing

- No behaviour, anywhere. The 0.3.0 release renames symbols and nothing else.
- No other export is removed or renamed.
- The three entry points, the error hierarchy, and the `ByteSource` contract are untouched.
