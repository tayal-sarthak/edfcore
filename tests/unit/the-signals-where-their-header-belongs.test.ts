/**
 * `header.signals` handed to the lookups in place of the header.
 *
 * The lookups search the signals, so `getSignal(recording.header.signals, 'Fp1')` is the call a
 * reader writes when they picture what is being searched. It was told "that is not a header — it
 * has no signals", about the one argument that is nothing but signals.
 */

import { expect, it } from 'vitest';
import { findSignals, getSignal, matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { minimalEdf } from '../support/writer.js';

it('names header.signals in all three lookups', async () => {
  const header = await readHeader(byteSource(minimalEdf()));
  const signals = header.signals as never;
  const label = header.signals[0]?.label ?? '';
  const named = 'that is header.signals, not the header';
  expect(() => getSignal(signals, label)).toThrow(`getSignal(): ${named}`);
  expect(() => findSignals(signals, label)).toThrow(`findSignals(): ${named}`);
  expect(() => matchSignals(signals, /./)).toThrow(`matchSignals(): ${named}`);
});
