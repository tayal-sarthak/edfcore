/**
 * Text from a file, on its way to a terminal.
 *
 * Layer 1, and one function, used by everything that prints a string edfcore read out of a file
 * rather than wrote itself. `counted.ts` beside it is the other half of the same job: the text
 * edfcore writes itself, where the decision is a plural rather than a control character.
 *
 * The rule it enforces is that a value can never become structure. EDF pads a label to 16 bytes
 * with spaces and says nothing about what else may be in them, and EDF+ annotation text is
 * exposed verbatim — the TAL grammar reserves only 0x00, 0x14 and 0x15, so 0x0a and 0x09 reach
 * `annotation.text` unchanged. Printed as-is into a table, a newline in a label opens a row that
 * describes a signal the file does not contain; a tab shifts every column after it, and in the
 * tab-separated CLI output it invents a whole field. A reader has no way to tell any of that from
 * a file that really is shaped that way.
 *
 * Replacement, not escaping, and not stripping. Stripping changes the width silently, so a
 * padded column stops lining up. Escaping to `\n` is two characters where the field allowed one,
 * which is right for a quoted value — `formatDiagnostics` does exactly that, inside quotes — and
 * wrong for a fixed-width cell. A dot is one character wide, visible, and unmistakably not the
 * byte that was there.
 *
 * Only C0 and DEL are replaced. Latin-1 letters above 0x7f are ordinary characters in an
 * electrode label written on a European system, and 0x80-0x9f are left alone because edfcore
 * decodes headers as ISO-8859-1, where that range is not control characters.
 *
 * That argument covers header text, which is Latin-1 and therefore stops at U+00FF. It is not the
 * only thing printed through here: ANNOTATION text is UTF-8, so `U+2028 LINE SEPARATOR` and
 * anything else above U+00FF can arrive from a file — `cli-run.ts` prints it for `events` and
 * `format-annotations.ts` for the hypnogram. Those pass through unchanged, deliberately. No
 * terminal and no HTML renderer breaks a line on U+2028, so it is not structure in any output
 * edfcore produces, and replacing it would be replacing a character an annotation legitimately
 * contains. The rule is about what the OUTPUT treats as structure, not about what a language
 * specification calls a line terminator.
 */

/** Every C0 control character and DEL becomes `.`; everything else is returned unchanged. */
export function printable(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? '.' : character;
  }
  return out;
}
