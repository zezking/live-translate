import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SetupView } from './SetupView.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

const setup = (props: Partial<React.ComponentProps<typeof SetupView>> = {}) =>
  render(wrap(<SetupView adminKey="" onSetAdminKey={() => {}} onBegin={() => {}} {...props} />));

describe('SetupView', () => {
  it('without adminKey shows the admin step (no language pickers)', () => {
    const { getByText, queryByRole } = setup({ adminKey: '' });
    expect(getByText(/Admin password/i)).toBeTruthy();
    expect(queryByRole('combobox')).toBeNull();
  });

  it('admin Continue stores the key', () => {
    const onSetAdminKey = vi.fn();
    const { getByPlaceholderText, getByRole } = setup({ adminKey: '', onSetAdminKey });
    fireEvent.change(getByPlaceholderText(/Admin password/i), { target: { value: 'centrechurch' } });
    fireEvent.click(getByRole('button', { name: /Continue/i }));
    expect(onSetAdminKey).toHaveBeenCalledWith('centrechurch');
  });

  it('pair picker defaults to English ↔ Korean and Begin fires onBegin with the pair', () => {
    const onBegin = vi.fn();
    const { getByRole, getByDisplayValue } = setup({ adminKey: 'k', onBegin });
    expect(getByDisplayValue('English')).toBeTruthy();
    expect(getByDisplayValue('한국어')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /Begin/i }));
    expect(onBegin).toHaveBeenCalledWith(['en', 'ko']);
  });

  it('Begin is disabled when both picks are the same language', () => {
    const { getAllByRole, getByRole } = setup({ adminKey: 'k' });
    const [first] = getAllByRole('combobox');
    fireEvent.change(first, { target: { value: 'ko' } });
    expect((getByRole('button', { name: /Begin/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
