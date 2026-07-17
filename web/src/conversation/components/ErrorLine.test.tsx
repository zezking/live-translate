import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ErrorLine } from './ErrorLine.js';
import { I18nProvider } from '../i18n.js';
import type { Locale } from '../types.js';

const wrap = (ui: React.ReactNode, locale: Locale = 'en') => <I18nProvider locale={locale}>{ui}</I18nProvider>;

describe('ErrorLine', () => {
  it('maps mic_blocked through t()', () => {
    const { getByText } = render(wrap(<ErrorLine message="mic_blocked" onDismiss={() => {}} />));
    expect(getByText(/Microphone blocked/)).toBeTruthy();
  });
  it('maps unauthorized through t() in en and ko', () => {
    const { getByText: getEn } = render(wrap(<ErrorLine message="unauthorized" onDismiss={() => {}} />));
    expect(getEn('Wrong admin password.')).toBeTruthy();
    const { getByText: getKo } = render(wrap(<ErrorLine message="unauthorized" onDismiss={() => {}} />, 'ko'));
    expect(getKo('관리 비밀번호가 틀렸어요.')).toBeTruthy();
  });
  it('renders unknown error strings as-is', () => {
    const { getByText } = render(wrap(<ErrorLine message="create failed" onDismiss={() => {}} />));
    expect(getByText('create failed')).toBeTruthy();
  });
  it('calls onDismiss when tapped', () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(wrap(<ErrorLine message="mic_blocked" onDismiss={onDismiss} />));
    fireEvent.click(getByRole('button'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
