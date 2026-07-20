import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { SetupView } from './SetupView.js';
import { I18nProvider } from '../i18n.js';

const wrap = (ui: React.ReactNode) => <I18nProvider locale="en">{ui}</I18nProvider>;

const setup = (props: Partial<React.ComponentProps<typeof SetupView>> = {}) =>
  render(
    wrap(
      <SetupView
        adminKey=""
        onSetAdminKey={() => {}}
        onValidateAdmin={() => Promise.resolve(true)}
        onBegin={() => {}}
        {...props}
      />,
    ),
  );

describe('SetupView', () => {
  it('without adminKey shows the admin step (no language pickers)', () => {
    const { getByText, queryByRole } = setup({ adminKey: '' });
    expect(getByText(/Admin password/i)).toBeTruthy();
    expect(queryByRole('combobox')).toBeNull();
  });

  it('admin Continue validates, then stores the key on success', async () => {
    const onSetAdminKey = vi.fn();
    const onValidateAdmin = vi.fn().mockResolvedValue(true);
    const { getByPlaceholderText, getByRole } = setup({ adminKey: '', onSetAdminKey, onValidateAdmin });
    fireEvent.change(getByPlaceholderText(/Admin password/i), { target: { value: 'centrechurch' } });
    fireEvent.click(getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(onSetAdminKey).toHaveBeenCalledWith('centrechurch'));
    expect(onValidateAdmin).toHaveBeenCalledWith('centrechurch');
  });

  it('wrong password shows an inline error and does NOT store the key', async () => {
    const onSetAdminKey = vi.fn();
    const onValidateAdmin = vi.fn().mockResolvedValue(false);
    const { getByPlaceholderText, getByRole, getByText } = setup({ adminKey: '', onSetAdminKey, onValidateAdmin });
    fireEvent.change(getByPlaceholderText(/Admin password/i), { target: { value: 'nope' } });
    fireEvent.click(getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(getByText(/Wrong admin password/i)).toBeTruthy());
    expect(onSetAdminKey).not.toHaveBeenCalled();
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
