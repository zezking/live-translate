import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PressArea } from './PressArea.js';

describe('PressArea', () => {
  it('pointerdown fires onDown; pointerup and pointercancel fire onUp', () => {
    const onDown = vi.fn();
    const onUp = vi.fn();
    const { getByRole } = render(<PressArea label="Hold to speak English" color="#c0623a" held={false} disabled={false} onDown={onDown} onUp={onUp} />);
    const btn = getByRole('button');
    fireEvent.pointerDown(btn);
    expect(onDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.pointerCancel(btn);
    expect(onUp).toHaveBeenCalledTimes(2);
  });

  it('disabled blocks onDown', () => {
    const onDown = vi.fn();
    const { getByRole } = render(<PressArea label="x" color="#000" held={false} disabled={true} onDown={onDown} onUp={() => {}} />);
    fireEvent.pointerDown(getByRole('button'));
    expect(onDown).not.toHaveBeenCalled();
  });

  it('held state is exposed via data-held', () => {
    const { getByRole } = render(<PressArea label="x" color="#000" held={true} disabled={false} onDown={() => {}} onUp={() => {}} />);
    expect(getByRole('button').getAttribute('data-held')).toBe('true');
  });
});
