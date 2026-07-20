import { createContext, useContext, type ReactNode } from 'react';

export type Locale = 'en' | 'ko';

/** en/ko string table for the single-device conversation UI (warm-state copy from the design spec). */
export const STRINGS = {
  en: {
    title: 'Conversation',
    setup_subtitle: 'Pick the two languages.',
    begin: 'Begin',
    connecting: 'Connecting…',
    hold_to_talk: 'Hold a button to talk',
    listening: 'Listening…',
    paused: 'Paused.',
    tap_resume: 'Tap to resume.',
    reconnecting: 'Catching up… translation resumes in a moment.',
    ended: 'Conversation ended.',
    warm_close: 'A quiet, warm close.',
    begin_another: 'Start another conversation',
    pause: 'Pause',
    resume: 'Resume',
    end: 'End conversation',
    mic: 'Microphone',
    mic_blocked: 'Microphone blocked. Use HTTPS and grant permission.',
    unauthorized: 'Wrong admin password.',
    admin_password: 'Admin password',
    admin_continue: 'Continue',
    voice_over: 'Voice-over',
    voice_clone: 'Voice cloning',
  },
  ko: {
    title: '대화',
    setup_subtitle: '두 언어를 선택하세요.',
    begin: '시작',
    connecting: '연결 중…',
    hold_to_talk: '버튼을 눌러 말하세요',
    listening: '듣는 중…',
    paused: '일시정지됨.',
    tap_resume: '눌러서 다시 시작하세요.',
    reconnecting: '잠시만 기다려 주세요… 곧 번역이 다시 이어집니다.',
    ended: '대화가 종료되었습니다.',
    warm_close: '따뜻하게 마무리해요.',
    begin_another: '새 대화 시작하기',
    pause: '일시정지',
    resume: '계속',
    end: '대화 종료',
    mic: '마이크',
    mic_blocked: '마이크 차단됨. HTTPS로 접속하고 권한을 허용하세요.',
    unauthorized: '관리 비밀번호가 틀렸어요.',
    admin_password: '관리 비밀번호',
    admin_continue: '계속',
    voice_over: '음성 재생',
    voice_clone: '음성 복제',
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

const I18nContext = createContext<Locale>('en');

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext);
}

export function useT(): (key: StringKey) => string {
  const locale = useContext(I18nContext);
  return (key: StringKey) => STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
}
