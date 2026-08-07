"""
Reference values for the REAL corpus files, from pyEDFlib.

`tests/corpus/corpus.test.ts` already reads these files and checks that what comes out is
plausible: an 8.5 Hz channel really oscillates at 8.5 Hz, a rectal temperature really lands near
37 degrees. That is a genuine cross-check and it is not an exact one — it would pass for a reader
that was slightly wrong everywhere.

This records what pyEDFlib gets from the same bytes, so the corpus check becomes an identity rather
than a plausibility argument. The synthetic harness (`generate.py`) proves the arithmetic on files
this project caused to exist; these files were written by other people's software and hardware,
years ago, and include a 22-hour clinical polysomnogram.

A BOUNDED WINDOW per signal, not the whole file: SC4001E0-PSG.edf is 48 MB and 2650 records, and a
golden holding every sample would be larger than the repository. The windows are taken at the
start, deep inside, and at the very end, because a reader that drifts does so with distance from
the start — which is exactly what a sample near record 0 cannot show.

Regenerate (needs the corpus: `npm run corpus:fetch`):
    .venv/bin/python scripts/golden/generate-corpus.py
"""

import json
import struct
from pathlib import Path

import pyedflib

ROOT = Path(__file__).resolve().parents[2]
FILES = ROOT / "tests" / "corpus" / "files"
OUT = ROOT / "tests" / "corpus" / "golden"

SAMPLES_PER_WINDOW = 256


def bits(value: float) -> str:
    return struct.pack(">d", value).hex()


def windows(total):
    """Start, middle and end. `total` is this signal's whole sample count."""
    if total <= SAMPLES_PER_WINDOW:
        return [("start", 0)]
    return [
        ("start", 0),
        ("middle", (total // 2) - SAMPLES_PER_WINDOW // 2),
        # The last full window, where accumulated drift is largest.
        ("end", total - SAMPLES_PER_WINDOW),
    ]


def record(name):
    path = FILES / name
    if not path.exists():
        print(f"{name}: absent, skipped (run npm run corpus:fetch)")
        return

    reader = pyedflib.EdfReader(str(path))
    signals = []
    for index in range(reader.signals_in_file):
        total = int(reader.getNSamples()[index])
        if total == 0:
            continue
        entries = []
        for label, start in windows(total):
            physical = reader.readSignal(index, start=start, n=SAMPLES_PER_WINDOW)
            digital = reader.readSignal(index, start=start, n=SAMPLES_PER_WINDOW, digital=True)
            entries.append(
                {
                    "window": label,
                    "firstSampleIndex": int(start),
                    "digital": [int(v) for v in digital],
                    "physicalBits": [bits(float(v)) for v in physical],
                }
            )
        signals.append(
            {
                "index": index,
                "label": reader.getLabel(index).strip(),
                "dimension": reader.getPhysicalDimension(index).strip(),
                "sampleCount": total,
                "windows": entries,
            }
        )

    golden = {
        "file": name,
        "producer": f"pyedflib {pyedflib.__version__}",
        "recordCount": int(reader.datarecords_in_file),
        "recordDurationSeconds": float(reader.datarecord_duration),
        "samplesPerWindow": SAMPLES_PER_WINDOW,
        "signals": signals,
    }
    reader.close()

    (OUT / f"corpus-{name}.json").write_text(json.dumps(golden) + "\n")
    total_samples = sum(len(w["digital"]) for s in signals for w in s["windows"])
    print(f"{name}: {len(signals)} signal(s), {total_samples} samples recorded")


OUT.mkdir(parents=True, exist_ok=True)
for name in [
    "SC4001E0-PSG.edf",
    "test_generator.edf",
    "test_generator_2.edf",
    "test_generator_2.bdf",
]:
    record(name)
