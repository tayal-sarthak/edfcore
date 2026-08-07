"""
Golden physical values, produced by pyEDFlib rather than by edfcore.

edfcore pins EDFlib's exact scaling expression — `bitValue * (offset + digital)`, in that order —
rather than the numerically better `physicalMinimum + (digital - digitalMinimum) * gain`. That is
a deliberate choice with one purpose: float64 bit-parity with EDFlib and pyEDFlib. Until this
script existed the choice was justified by reasoning and pinned by a test that re-derived the same
expression, which proves edfcore agrees with itself and nothing more.

This writes real EDF and BDF files with pyEDFlib's own writer, reads them back with pyEDFlib, and
records every physical sample as its exact IEEE-754 bit pattern. `tests/corpus/golden/*.json` is
therefore an artifact of pyEDFlib, and the test that consumes it compares with `Object.is` — a
one-ULP difference is a failure, not a rounding detail.

Regenerate with:
    python3 -m venv .venv && .venv/bin/pip install pyedflib
    .venv/bin/python scripts/golden/generate.py
"""

import datetime
import json
import struct
from pathlib import Path

import numpy as np
import pyedflib

OUT = Path(__file__).resolve().parents[2] / "tests" / "corpus" / "golden"


def bits(value: float) -> str:
    """The exact float64, as 16 hex digits. Decimal would invite a round-trip argument."""
    return struct.pack(">d", value).hex()


def case(name, file_type, signals, seconds=4):
    """Write a file with pyEDFlib, read it back with pyEDFlib, record what it says."""
    path = OUT / f"{name}.{'bdf' if 'BDF' in file_type else 'edf'}"
    writer = pyedflib.EdfWriter(str(path), len(signals), file_type=getattr(pyedflib, file_type))

    headers = []
    data = []
    for spec in signals:
        rate = spec["rate"]
        headers.append(
            {
                "label": spec["label"],
                "dimension": spec.get("dimension", "uV"),
                "sample_frequency": rate,
                "physical_min": spec["physical_min"],
                "physical_max": spec["physical_max"],
                "digital_min": spec["digital_min"],
                "digital_max": spec["digital_max"],
                "transducer": "",
                "prefilter": "",
            }
        )
        # A deterministic ramp that visits both ends of the digital range and the values in
        # between, so the comparison exercises the whole affine map rather than one region.
        n = rate * seconds
        lo, hi = spec["digital_min"], spec["digital_max"]
        digital = np.linspace(lo, hi, n, dtype=np.float64).round().astype(np.int64)
        digital[0] = lo
        digital[-1] = hi
        data.append(digital)

    writer.setSignalHeaders(headers)
    writer.setStartdatetime(datetime.datetime(2020, 1, 1, 10, 0, 0))
    # digital=True writes the exact integer codes chosen above, so what lands on disk is what the
    # goldens were computed from — no rounding between the two.
    writer.writeSamples([d.astype(np.int32) for d in data], digital=True)
    writer.close()

    reader = pyedflib.EdfReader(str(path))
    golden = {
        "file": path.name,
        "producer": f"pyedflib {pyedflib.__version__}",
        "signals": [],
    }
    for i in range(reader.signals_in_file):
        physical = reader.readSignal(i)
        digital = reader.readSignal(i, digital=True)
        golden["signals"].append(
            {
                "index": i,
                "label": reader.getLabel(i).strip(),
                "physicalMinimum": reader.getPhysicalMinimum(i),
                "physicalMaximum": reader.getPhysicalMaximum(i),
                "digitalMinimum": int(reader.getDigitalMinimum(i)),
                "digitalMaximum": int(reader.getDigitalMaximum(i)),
                "sampleCount": int(len(physical)),
                "digital": [int(v) for v in digital],
                "physicalBits": [bits(float(v)) for v in physical],
            }
        )
    reader.close()

    (OUT / f"{name}.json").write_text(json.dumps(golden, indent=1) + "\n")
    print(f"{name}: {reader.signals_in_file} signal(s), {len(golden['signals'][0]['digital'])} samples")


OUT.mkdir(parents=True, exist_ok=True)

case(
    "edf-symmetric",
    "FILETYPE_EDFPLUS",
    [
        {"label": "EEG Fpz-Cz", "rate": 64, "physical_min": -500.0, "physical_max": 500.0,
         "digital_min": -32768, "digital_max": 32767},
    ],
)

case(
    "edf-asymmetric",
    "FILETYPE_EDFPLUS",
    [
        # Asymmetric ranges are where the pinned and the textbook expressions disagree most.
        {"label": "EEG asym", "rate": 32, "physical_min": -123.456, "physical_max": 987.654,
         "digital_min": -2048, "digital_max": 2047},
        {"label": "Temp rectal", "rate": 4, "dimension": "degC", "physical_min": 34.4,
         "physical_max": 40.2, "digital_min": -32768, "digital_max": 32767},
    ],
)

case(
    "bdf-24bit",
    "FILETYPE_BDFPLUS",
    [
        # 24-bit: a float32 result would lose about a quarter of a quantisation step here.
        {"label": "A1", "rate": 32, "physical_min": -262144.0, "physical_max": 262144.0,
         "digital_min": -8388608, "digital_max": 8388607},
    ],
)

case(
    "edf-negative-gain",
    "FILETYPE_EDFPLUS",
    [
        # physicalMinimum > physicalMaximum is legal and encodes a negative amplifier gain
        # (EDF FAQ Q6). edfcore never swaps the two, because a silent polarity flip is a
        # clinically wrong result that looks completely normal — so parity here is the check that
        # edfcore and pyEDFlib agree about the SIGN as well as the magnitude.
        {"label": "Inverted", "rate": 32, "physical_min": 500.0, "physical_max": -500.0,
         "digital_min": -32768, "digital_max": 32767},
    ],
)

case(
    "edf-narrow-digital",
    "FILETYPE_EDFPLUS",
    [
        # A narrow digital range with a wide physical one: the largest bitValue of the set, where
        # the two expressions' disagreement is coarsest.
        {"label": "Coarse", "rate": 16, "physical_min": -1000.0, "physical_max": 1000.0,
         "digital_min": -8, "digital_max": 7},
        # And the opposite: a wide digital range mapped to a tiny physical one.
        {"label": "Fine", "rate": 16, "dimension": "mV", "physical_min": -0.5,
         "physical_max": 0.5, "digital_min": -32768, "digital_max": 32767},
    ],
)
