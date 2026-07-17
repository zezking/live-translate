import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from './types.js';

/** en/ko string table. Ported from v1 public/i18n.js + warm-state copy from the design spec. */
export const STRINGS = {
  en: {
    title: 'Conversation',
    subtitle: 'A few words, and we’ll translate.',
    your_name: 'Your name',
    partner_name: 'Partner’s name',
    voice_over: 'Voice-over',
    voice_clone: 'Voice cloning',
    begin: 'Begin',
    join: '참여하기', // joiner button label is Korean even in the en table (joiner UI is Korean); overridden by locale below
    scan_qr: 'Scan this on the partner’s phone',
    show_code: 'Show this to', // followed by the partner name
    waiting: 'Waiting for partner…',
    listening: 'Listening…',
    paused: 'Paused.',
    tap_resume: 'Tap to resume.',
    partner_away: 'stepped away… we’ll pick up when they’re back.',
    reconnecting: 'Catching up… translation resumes in a moment.',
    ended: 'Conversation ended.',
    warm_close: 'A quiet, warm close.',
    begin_another: 'Start another conversation',
    pause: 'Pause',
    resume: 'Resume',
    end: 'End conversation',
    you: 'You',
    mic: 'Microphone',
    mic_blocked: 'Microphone blocked. Use HTTPS and grant permission.',
    unauthorized: 'Wrong admin password.',
    admin_password: 'Admin password',
    admin_continue: 'Continue',
    invited: '{host} invited you',
  },
  ko: {
    title: '대화',
    subtitle: '몇 마디면, 번역해 드릴게요.',
    your_name: '내 이름',
    partner_name: '상대방 이름',
    voice_over: '음성 재생',
    voice_clone: '음성 복제',
    begin: '시작',
    join: '참여하기',
    scan_qr: '상대방 전화에서 이 QR을 스캔하세요',
    show_code: '이 분에게 보여주세요:',
    waiting: '상대방을 기다리는 중…',
    listening: '듣는 중…',
    paused: '일시정지됨.',
    tap_resume: '눌러서 다시 시작하세요.',
    partner_away: '잠시 자리를 비우셨어요… 돌아오시면 이어서 할게요.',
    reconnecting: '잠시만 기다려 주세요… 곧 번역이 다시 이어집니다.',
    ended: '대화가 종료되었습니다.',
    warm_close: '따뜻하게 마무리해요.',
    begin_another: '새 대화 시작하기',
    pause: '일시정지',
    resume: '계속',
    end: '대화 종료',
    you: '나',
    mic: '마이크',
    mic_blocked: '마이크 차단됨. HTTPS로 접속하고 권한을 허용하세요.',
    unauthorized: '관리 비밀번호가 틀렸어요.',
    admin_password: '관리 비밀번호',
    admin_continue: '계속',
    invited: '{host} 님이 초대했어요',
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
