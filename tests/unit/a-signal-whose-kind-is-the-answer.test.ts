/**
 * A signal handed to `isAnnotationLabel`.
 *
 * `header.signals.filter(isAnnotationLabel)` is what gets written, and the refusal sent it to
 * `signal.label`. That works, and repeats a check the header already made: every signal's `kind`
 * is `isAnnotationLabel(label)` computed at parse time, so the caller holding one has the answer.
 */

import { expect, it } from 'vitest';
import { isAnnotationLabel } from '../../src/header/lookup.js';
import { parseHeader } from '../../src/header/parse.js';
import { minimalEdf } from '../support/writer.js';

it('isAnnotationLabel() names signal.kind for a signal', () => {
  const file = minimalEdf();
  const [signal] = parseHeader(file, file.byteLength).signals;
  expect(() => isAnnotationLabel(signal as never)).toThrow(
    'Next: pass signal.label, which is the field this asks about — or read signal.kind === ' +
      "'annotations', which is this answer already.",
  );
  expect(() => isAnnotationLabel(7 as never)).toThrow('the field this asks about.');
});
