"""
EDF+ annotations, as pyEDFlib reads them.

The scaling harness checks arithmetic. This checks the other thing edfcore has got wrong more than
once: WHICH AXIS an onset is on. Six releases fixed a variant of "one function used the nominal
grid while the rest used the record's true onset", and every one of those was caught by comparing
edfcore against itself. An external reader is a different kind of evidence.

pyEDFlib reports onsets in seconds from the recording start. The fixture below deliberately gives
record 0 a sub-second start offset, because that is where the two candidate axes part company and
where edfcore's own defects lived.

Regenerate:
    .venv/bin/python scripts/golden/generate-annotations.py
"""

import datetime
import json
import struct
from pathlib import Path

import numpy as np
import pyedflib

OUT = Path(__file__).resolve().parents[2] / "tests" / "corpus" / "golden"

RATE = 16
SECONDS = 8
NAME = "edf-annotations"

# (onset seconds, duration seconds or -1 for none, text)
EVENTS = [
    (0.0, -1, "Recording starts"),
    (1.25, 0.5, "Spindle"),
    (3.0, 30.0, "Sleep stage W"),
    (4.5, -1, "Arousal"),
    (6.125, 0.25, "K complex"),
]


def bits(value: float) -> str:
    return struct.pack(">d", value).hex()


path = OUT / f"{NAME}.edf"
writer = pyedflib.EdfWriter(str(path), 1, file_type=pyedflib.FILETYPE_EDFPLUS)
writer.setSignalHeaders(
    [
        {
            "label": "Fp1",
            "dimension": "uV",
            "sample_frequency": RATE,
            "physical_min": -500.0,
            "physical_max": 500.0,
            "digital_min": -32768,
            "digital_max": 32767,
            "transducer": "",
            "prefilter": "",
        }
    ]
)
# Room for every TAL. The default region holds only the timekeeping TAL plus a little.
writer.set_number_of_annotation_signals(6)
writer.setStartdatetime(datetime.datetime(2020, 1, 1, 10, 0, 0))
# `writeSamples` with a per-signal list writes every record; `writeDigitalSamples` with one flat
# array wrote a single record, leaving the later annotations pointing past the end of the data.
writer.writeSamples(
    [np.linspace(-32768, 32767, RATE * SECONDS).round().astype(np.int32)], digital=True
)
for onset, duration, text in EVENTS:
    writer.writeAnnotation(onset, duration, text)
writer.close()

reader = pyedflib.EdfReader(str(path))
onsets, durations, descriptions = reader.readAnnotations()
golden = {
    "file": path.name,
    "producer": f"pyedflib {pyedflib.__version__}",
    "recordDurationSeconds": float(reader.datarecord_duration),
    "recordCount": int(reader.datarecords_in_file),
    "annotations": [
        {
            "onsetSeconds": float(onset),
            "onsetBits": bits(float(onset)),
            # pyEDFlib writes -1 for "this event has no duration"; EDF+ omits the field.
            "durationSeconds": float(duration),
            "text": str(text),
        }
        for onset, duration, text in zip(onsets, durations, descriptions)
    ],
}
reader.close()

# pyEDFlib DROPS an annotation that does not fit the region it sized, silently. Recording fewer
# than were written would make the parity test compare an incomplete set and pass while doing it.
if len(golden["annotations"]) != len(EVENTS):
    raise SystemExit(
        f"only {len(golden['annotations'])} of {len(EVENTS)} annotations round-tripped — raise "
        "set_number_of_annotation_signals until every one survives"
    )

(OUT / f"{NAME}.json").write_text(json.dumps(golden, indent=1) + "\n")
print(f"{NAME}: {len(golden['annotations'])} annotation(s) of {len(EVENTS)} written")
for a in golden["annotations"]:
    print(f"  {a['onsetSeconds']:>8} {a['durationSeconds']:>6}  {a['text']}")
