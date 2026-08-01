/**
 * Builds a small, valid EDF+C file in the browser.
 *
 * The inspector is only convincing if you can try it, and most visitors will not have an EDF
 * file to hand. This generates one — a two-minute, four-channel montage with a handful of
 * scored events — so the demo has something real to decode. It is a fixture generator, not
 * part of edfcore: the library is read-only, and writing correct EDF is a much larger
 * commitment than reading it.
 */

const SPACE = 0x20;

function pad(text: string, width: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < width; i += 1) {
    out.push(i < text.length ? text.charCodeAt(i) & 0xff : SPACE);
  }
  return out;
}

interface Channel {
  label: string;
  unit: string;
  hz: number;
  physicalMin: number;
  physicalMax: number;
  sample: (second: number, index: number) => number;
}

const RECORD_SECONDS = 1;
const DURATION_SECONDS = 120;
const ANNOTATION_BYTES = 120;

/** A deterministic wobble, so the same file comes out on every machine. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const CHANNELS: Channel[] = [
  {
    label: 'EEG Fpz-Cz',
    unit: 'uV',
    hz: 100,
    physicalMin: -250,
    physicalMax: 250,
    sample: (s, i) => {
      const t = s + i / 100;
      // Sleep-ish: alpha that gives way to slow waves, with two K-complexes.
      const depth = Math.min(1, Math.max(0, (t - 25) / 55));
      const alpha = Math.sin(t * 2 * Math.PI * 10) * 26 * (1 - depth);
      const delta = Math.sin(t * 2 * Math.PI * 1.4) * 44 * depth;
      const k = t > 62 && t < 63.4 ? Math.sin(((t - 62) / 1.4) * Math.PI) * -120 : 0;
      const k2 = t > 95 && t < 96.2 ? Math.sin(((t - 95) / 1.2) * Math.PI) * -104 : 0;
      return alpha + delta + k + k2 + noise(t * 91) * 7;
    },
  },
  {
    label: 'EOG horizontal',
    unit: 'uV',
    hz: 100,
    physicalMin: -500,
    physicalMax: 500,
    sample: (s, i) => {
      const t = s + i / 100;
      // Slow drift, plus rapid eye movements late in the recording.
      const rem = t > 100 ? Math.sin(t * 2 * Math.PI * 1.1) * 180 : 0;
      return Math.sin(t * 0.4) * 60 + rem + noise(t * 37) * 9;
    },
  },
  {
    label: 'EMG submental',
    unit: 'uV',
    hz: 100,
    physicalMin: -125,
    physicalMax: 125,
    sample: (s, i) => {
      const t = s + i / 100;
      const tone = Math.max(0.12, 1 - t / 140);
      return noise(t * 733) * 38 * tone;
    },
  },
  {
    label: 'Resp nasal',
    unit: 'mV',
    hz: 10,
    physicalMin: -2,
    physicalMax: 2,
    sample: (s, i) => {
      const t = s + i / 10;
      // A breathing rhythm with one apnea, which is what the event marks.
      const amp = t > 70 && t < 84 ? 0.06 : 1;
      return Math.sin(t * 2 * Math.PI * 0.22) * 0.85 * amp;
    },
  },
];

const EVENTS: Array<{ onset: number; duration?: number; text: string }> = [
  { onset: 0, duration: 25, text: 'Sleep stage W' },
  { onset: 25, duration: 45, text: 'Sleep stage N2' },
  { onset: 62, text: 'K-complex' },
  { onset: 70, duration: 14, text: 'Obstructive apnea' },
  { onset: 70.5, duration: 13, text: 'Desaturation' },
  { onset: 95, text: 'K-complex' },
  { onset: 100, duration: 20, text: 'Sleep stage REM' },
];

function tal(onset: number, duration: number | undefined, texts: string[]): number[] {
  const out: number[] = [];
  const push = (s: string) => {
    for (const byte of new TextEncoder().encode(s)) out.push(byte);
  };
  push(`${onset < 0 ? '-' : '+'}${trimNumber(Math.abs(onset))}`);
  if (duration !== undefined) {
    out.push(0x15);
    push(trimNumber(duration));
  }
  out.push(0x14);
  if (texts.length === 0) {
    out.push(0x14);
  } else {
    for (const text of texts) {
      push(text);
      out.push(0x14);
    }
  }
  out.push(0x00);
  return out;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function buildSampleEdf(): Uint8Array {
  const signalCount = CHANNELS.length + 1;
  const headerBytes = 256 * (signalCount + 1);
  const records = DURATION_SECONDS / RECORD_SECONDS;

  const perRecord = CHANNELS.map((c) => c.hz * RECORD_SECONDS);
  const recordBytes = 2 * (perRecord.reduce((a, b) => a + b, 0) + ANNOTATION_BYTES);

  const fixed: number[] = [];
  fixed.push(...pad('0', 8));
  fixed.push(...pad('MCH-0234567 F 18-MAR-1994 Anonymised', 80));
  fixed.push(...pad('Startdate 12-NOV-2025 PSG-0041 TECH-07 SomnoScreen', 80));
  fixed.push(...pad('12.11.25', 8));
  fixed.push(...pad('23.14.00', 8));
  fixed.push(...pad(String(headerBytes), 8));
  fixed.push(...pad('EDF+C', 44));
  fixed.push(...pad(String(records), 8));
  fixed.push(...pad(String(RECORD_SECONDS), 8));
  fixed.push(...pad(String(signalCount), 4));

  const labels = [...CHANNELS.map((c) => c.label), 'EDF Annotations'];
  const transducers = [...CHANNELS.map(() => 'AgAgCl electrode'), ''];
  const units = [...CHANNELS.map((c) => c.unit), ''];
  const physMin = [...CHANNELS.map((c) => String(c.physicalMin)), '-1'];
  const physMax = [...CHANNELS.map((c) => String(c.physicalMax)), '1'];
  const digMin = [...CHANNELS.map(() => '-32768'), '-32768'];
  const digMax = [...CHANNELS.map(() => '32767'), '32767'];
  const prefilter = [...CHANNELS.map(() => 'HP:0.5Hz LP:35Hz N:50Hz'), ''];
  const spr = [...perRecord.map(String), String(ANNOTATION_BYTES)];

  // The per-signal header is FIELD-MAJOR: all labels, then all transducers, and so on.
  const signalHeader: number[] = [];
  const write = (values: string[], width: number) => {
    for (const value of values) signalHeader.push(...pad(value, width));
  };
  write(labels, 16);
  write(transducers, 80);
  write(units, 8);
  write(physMin, 8);
  write(physMax, 8);
  write(digMin, 8);
  write(digMax, 8);
  write(prefilter, 80);
  write(spr, 8);
  write(
    labels.map(() => ''),
    32,
  );

  const out = new Uint8Array(headerBytes + recordBytes * records);
  out.set(Uint8Array.from(fixed), 0);
  out.set(Uint8Array.from(signalHeader), 256);

  let cursor = headerBytes;
  for (let r = 0; r < records; r += 1) {
    for (const channel of CHANNELS) {
      const count = channel.hz * RECORD_SECONDS;
      const scale = 32767 / channel.physicalMax;
      for (let i = 0; i < count; i += 1) {
        const physical = channel.sample(r * RECORD_SECONDS, i);
        const digital = Math.max(-32768, Math.min(32767, Math.round(physical * scale)));
        const encoded = digital < 0 ? digital + 0x10000 : digital;
        out[cursor] = encoded & 0xff;
        out[cursor + 1] = (encoded >> 8) & 0xff;
        cursor += 2;
      }
    }

    // The first TAL of every record is timekeeping: this record's start time.
    const region: number[] = tal(r * RECORD_SECONDS, undefined, []);
    for (const event of EVENTS) {
      if (event.onset >= r * RECORD_SECONDS && event.onset < (r + 1) * RECORD_SECONDS) {
        region.push(...tal(event.onset, event.duration, [event.text]));
      }
    }
    out.set(Uint8Array.from(region.slice(0, ANNOTATION_BYTES * 2)), cursor);
    cursor += ANNOTATION_BYTES * 2;
  }

  return out;
}
