/** Language metadata for the pair picker + PTT areas. */
export interface LanguageMeta {
  code: string;
  /** English name (menus, aria). */
  name: string;
  /** Native name (turn labels). */
  native: string;
  /** Full press-area label in the language itself. */
  ptt: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', name: 'English', native: 'English', ptt: 'Hold to speak English' },
  { code: 'ko', name: 'Korean', native: '한국어', ptt: '한국어로 말하려면 누르세요' },
  { code: 'zh', name: 'Chinese', native: '中文', ptt: '按住说中文' },
  { code: 'ja', name: 'Japanese', native: '日本語', ptt: '押して日本語を話してください' },
  { code: 'es', name: 'Spanish', native: 'Español', ptt: 'Mantén para hablar español' },
];

export function nativeName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.native ?? code;
}

export function pttLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.ptt ?? code;
}

/** Pair-position colors: A = terracotta, B = warm green. */
export function colorFor(index: 0 | 1): string {
  return index === 0 ? '#c0623a' : '#3a7a5a';
}
