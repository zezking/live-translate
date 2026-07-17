import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OnboardingView } from './OnboardingView.js';
import { I18nProvider } from '../i18n.js';

const setup = (props: Partial<React.ComponentProps<typeof OnboardingView>> = {}) =>
  render(
    <I18nProvider locale="en">
      <OnboardingView
        phase="onboarding"
        role="host"
        room={null}
        names={{ host: '', joiner: '' }}
        adminKey=""
        onBegin={() => {}}
        onJoin={() => {}}
        onSetAdminKey={() => {}}
        onBeginAnother={() => {}}
        {...props}
      />
    </I18nProvider>,
  );

describe('OnboardingView', () => {
  it('host setup: Begin calls onBegin with names + adminKey', () => {
    const onBegin = vi.fn();
    const { getByPlaceholderText, getByRole } = setup({ adminKey: 'centrechurch', onBegin });
    fireEvent.change(getByPlaceholderText(/Enze/), { target: { value: 'Enze' } });
    fireEvent.change(getByPlaceholderText(/아버님/), { target: { value: '아버님' } });
    fireEvent.click(getByRole('button', { name: /Begin/i }));
    expect(onBegin).toHaveBeenCalledWith('Enze', '아버님', 'centrechurch');
  });
  it('host setup without adminKey: shows admin-password step first', () => {
    const { getByText, queryByRole } = setup({ adminKey: '' });
    expect(getByText(/Admin password/i)).toBeTruthy();
    expect(queryByRole('button', { name: /^Begin$/i })).toBeNull();
  });
  it('waiting phase host shows the QR image', () => {
    const { getByAltText } = setup({ phase: 'waiting', adminKey: 'x', room: { roomId: 'r', hostToken: 'h', joinToken: 'j', joinUrl: 'u', qrDataUrl: 'data:image/png;base64,AAAA' } });
    expect(getByAltText(/QR/i).getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
  it('joiner welcome (Korean) shows 참여하기 and calls onJoin', () => {
    const onJoin = vi.fn();
    const { getByRole } = render(
      <I18nProvider locale="ko">
        <OnboardingView phase="onboarding" role="joiner" room={null} names={{ host: 'Enze', joiner: '' }} adminKey="" onBegin={() => {}} onJoin={onJoin} onSetAdminKey={() => {}} onBeginAnother={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(getByRole('button', { name: /참여하기/ }));
    expect(onJoin).toHaveBeenCalled();
  });
});
