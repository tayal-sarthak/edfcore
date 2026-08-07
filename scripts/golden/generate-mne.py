"""
The same fixtures, read by MNE, recorded in MNE's own units.

A second independent reader is worth more than a second opinion from the same one: pyEDFlib and
edfcore could in principle share a mistake, and MNE is a different implementation with a different
audience. But the claim it supports is NARROWER than the pyEDFlib one, and the difference matters:

MNE returns SI units. A microvolt channel comes back in volts, having been divided by 1e6, and that
division is lossy — multiplying back does not land on the same float64. Measured across these
fixtures the disagreement is at most 65 ULP, which is entirely the unit conversion and not a
disagreement about the sample. So bit-parity is claimed for pyEDFlib and NOT for MNE, and the test
this feeds asserts a tight ULP bound instead of `Object.is`.

Only channels MNE actually rescales are recorded. It leaves a `degC` channel alone, so comparing
one through a 1e6 factor would be comparing nothing.

Regenerate:
    .venv/bin/pip install mne
    .venv/bin/python scripts/golden/generate-mne.py
"""

import json
import struct
from pathlib import Path

import mne

OUT = Path(__file__).resolve().parents[2] / "tests" / "corpus" / "golden"

# unit on disk -> the factor MNE divides by to reach SI.
SCALED_UNITS = {"uV": 1e6, "mV": 1e3}


def bits(value: float) -> str:
    return struct.pack(">d", value).hex()


def record(name: str) -> None:
    path = OUT / f"{name}.edf"
    raw = mne.io.read_raw_edf(str(path), preload=True, verbose="ERROR")
    data = raw.get_data()

    signals = []
    for index, label in enumerate(raw.ch_names):
        # The unit as the FILE declares it, read back through pyedflib so this script does not
        # have to guess what MNE did.
        import pyedflib

        reader = pyedflib.EdfReader(str(path))
        unit = reader.getPhysicalDimension(index).strip()
        reader.close()
        if unit not in SCALED_UNITS:
            continue
        signals.append(
            {
                "index": index,
                "label": label,
                "unit": unit,
                "toSiDivisor": SCALED_UNITS[unit],
                "sampleCount": int(data.shape[1]),
                "siBits": [bits(float(v)) for v in data[index]],
            }
        )

    if not signals:
        print(f"{name}: no channel MNE rescales, skipped")
        return

    (OUT / f"{name}.mne.json").write_text(
        json.dumps(
            {"file": path.name, "producer": f"mne {mne.__version__}", "signals": signals}, indent=1
        )
        + "\n"
    )
    print(f"{name}: {len(signals)} channel(s) recorded in SI units")


for case in ["edf-symmetric", "edf-asymmetric", "edf-negative-gain", "edf-narrow-digital"]:
    record(case)
