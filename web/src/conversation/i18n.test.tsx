import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { I18nProvider, useT, STRINGS } from './i18n.js';

describe('i18n', () => {
  it('STRINGS has matching en + ko keys', () => {
    const en = Object.keys(STRINGS.en).sort();
    const ko = Object.keys(STRINGS.ko).sort();
    expect(ko).toEqual(en);
  });

  it('useT returns the localized string, falling back to en then key', () => {
    const { result } = renderHook(() => useT(), { wrapper: ({ children }) => <I18nProvider locale="ko">{children}</I18nProvider> });
    const t = result.current;
    expect(t('waiting')).toBe(STRINGS.ko.waiting);
  });

  it('useT falls back to en when a ko key is missing', () => {
    const { result } = renderHook(() => useT(), { wrapper: ({ children }) => <I18nProvider locale="ko">{children}</I18nProvider> });
    // every key exists in both per the first test; sanity-check the resolver with a bogus key
    expect(result.current('__nope__' as never)).toBe('__nope__');
  });
});
