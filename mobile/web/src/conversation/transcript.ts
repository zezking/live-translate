import type { Turn } from './types.js';
import { nativeName } from './languages.js';
import { STRINGS, type Locale } from './i18n.js';

export interface TranscriptOptions {
  turns: Turn[];
  languages: [string, string];
  locale: Locale;
  /** Injectable clock for tests. */
  now?: Date;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Hand-formatted (not toLocaleString) so output is identical across runtimes.
function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Render the finished conversation as plain text: each spoken original followed by its translation. */
export function formatTranscript({ turns, languages, locale, now = new Date() }: TranscriptOptions): string {
  const lines: string[] = [
    STRINGS[locale].transcript_title,
    `${nativeName(languages[0])} ↔ ${nativeName(languages[1])}`,
    localStamp(now),
    '',
  ];
  for (const turn of turns) {
    if (!turn.original.trim()) continue;
    lines.push(`${nativeName(turn.lang)}: ${turn.original}`);
    if (turn.translation.trim()) lines.push(`→ ${turn.translation}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Filesystem-safe name, e.g. `transcript-2026-09-14_15-42.txt` (no colons for Windows). */
export function transcriptFilename(now: Date = new Date()): string {
  return `transcript-${localStamp(now).replace(' ', '_').replace(':', '-')}.txt`;
}

/** Trigger a browser download of the formatted transcript. */
export function saveTranscriptToFile(options: TranscriptOptions): void {
  const now = options.now ?? new Date();
  const blob = new Blob([formatTranscript({ ...options, now })], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = transcriptFilename(now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
