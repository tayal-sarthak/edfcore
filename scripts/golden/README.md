# Golden values

Reference values produced by **pyEDFlib** and **MNE**, committed so the test suite never needs
Python. Nothing in `tests/corpus/golden/` is produced by edfcore.

## Why these exist

edfcore pins EDFlib's exact scaling expression — `bitValue * (offset + digital)`, in that order —
rather than the numerically better `physicalMinimum + (digital - digitalMinimum) * gain`. The only
justification for keeping the worse form is float64 bit-parity with the readers people compare
against. Every other test of that expression re-derives it inside the test, which proves edfcore
agrees with itself and nothing more.

The same applies to annotation onsets. Six releases fixed a variant of "one function used the
nominal grid while the rest used the record's true onset", and every one was found by comparing
edfcore against edfcore. An external reader is a different kind of evidence: a shared misreading of
the format satisfies an internal invariant and fails here.

## Regenerating

Needs Python. The venv is not committed and CI never builds it.

```bash
python3 -m venv .venv
.venv/bin/pip install pyedflib mne
.venv/bin/python scripts/golden/generate.py             # physical values, EDF and BDF
.venv/bin/python scripts/golden/generate-annotations.py # EDF+ annotation onsets
.venv/bin/python scripts/golden/generate-mne.py         # the same files, read by MNE
.venv/bin/python scripts/golden/generate-corpus.py      # the REAL corpus (needs corpus:fetch)
```

Each script writes its fixtures with the reference library's own writer, reads them back with that
same library, and records the answer. Commit the regenerated `tests/corpus/golden/` alongside any
change, and say in the changelog which library version produced it — the `producer` field in every
golden file records it, and the tests assert it is present.

## What each claim is worth

| Harness | Files | Claim | Strength |
|---|---|---|---|
| `golden-values.test.ts` | synthetic | edfcore reproduces pyEDFlib's float64 physical values | **bit for bit** (`Object.is`) |
| `corpus-parity.test.ts` | **real** | the same, on files other people's software wrote | **bit for bit** |
| `annotation-parity.test.ts` | synthetic | edfcore and pyEDFlib place every annotation at the same onset | exact, to the tick |
| `mne-parity.test.ts` | synthetic | edfcore agrees with MNE | 1e-12 relative, **not** bit-exact |

`corpus-parity.test.ts` is the strongest of these and the only one whose inputs nobody here chose:
a 22-hour clinical polysomnogram from sleep-edfx, plus the teuniz generator files in EDF, EDF+ and
24-bit BDF+. It needs the corpus, so it skips on a fresh clone:

```bash
npm run corpus:fetch
```

It samples a bounded window per signal rather than whole files — the PSG alone is 48 MB — taken at
the **start, the middle and the end**. The end window is the one that earns its place: a reader
whose record arithmetic drifts does so with distance from the start, and a sample near record 0
cannot show it.

The MNE bound is weaker on purpose. MNE returns SI units, so a microvolt channel arrives divided by
1e6 and that division is lossy — the two cannot be bit-identical, and claiming otherwise would be
claiming something false. Channels MNE does not rescale are excluded rather than pushed through a
factor that would make the comparison an artefact of the test.

## Adding a case

Pick one where the two candidate expressions diverge, or where a mistake would be least visible.
The existing set covers a symmetric range, an asymmetric one, 24-bit BDF, a negative amplifier
gain, and the coarsest and finest `bitValue` ratios that fit an 8-byte field.

A value comparison alone cannot catch a mistake both libraries make. The negative-gain case is
therefore also asserted against the **file's own declaration** — physical values must fall as
digital values rise — because a field swap that pyEDFlib shared would otherwise be invisible.
